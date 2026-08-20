/**
 * Arena — Press Feed RSS Ingestion
 *
 * Runs from the cron trigger. Fetches the RSS sources configured in
 * PRESS_FEED_RSS_SOURCES (comma-separated URLs, optionally "label|url" pairs)
 * and upserts headlines into press_feed_items so the public press feed stays
 * current instead of freezing at whatever was last seeded.
 *
 * The parser is deliberately minimal (RSS 2.0 <item> blocks) — feeds are
 * upstream-controlled text, so everything is length-capped and stored via
 * bound parameters only.
 */

const FETCH_TIMEOUT_MS = 10000;
const MAX_ITEMS_PER_FEED = 30;
const MAX_TEXT = 500;

function stripCdata(value) {
  return String(value || '')
    .replace(/^<!\[CDATA\[/, '')
    .replace(/\]\]>$/, '')
    .trim();
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function firstTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? decodeEntities(stripCdata(match[1])).slice(0, MAX_TEXT) : '';
}

export function parseRssItems(xml) {
  const items = [];
  const channelTitle = firstTag(xml, 'title');
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const block of blocks.slice(0, MAX_ITEMS_PER_FEED)) {
    const title = firstTag(block, 'title');
    const link = firstTag(block, 'link');
    const pubDate = firstTag(block, 'pubDate');
    const category = firstTag(block, 'category');
    if (!title || !link || !/^https?:\/\//i.test(link)) continue;
    let publishedAt = null;
    if (pubDate) {
      const parsed = new Date(pubDate);
      if (!Number.isNaN(parsed.getTime())) publishedAt = parsed.toISOString();
    }
    items.push({ title, url: link, published_at: publishedAt, section: category || null });
  }
  return { channelTitle, items };
}

export function parsePressFeedSources(raw) {
  return String(raw || '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => {
      const pipe = entry.indexOf('|');
      if (pipe > 0) {
        return { label: entry.slice(0, pipe).trim(), url: entry.slice(pipe + 1).trim() };
      }
      try {
        return { label: new URL(entry).hostname.replace(/^www\./, ''), url: entry };
      } catch {
        return null;
      }
    })
    .filter(source => source && /^https?:\/\//i.test(source.url));
}

async function hashText(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function ingestPressFeeds(env) {
  const sources = parsePressFeedSources(env.PRESS_FEED_RSS_SOURCES);
  if (sources.length === 0) return { ingested: 0, sources: 0 };

  let ingested = 0;
  for (const source of sources) {
    try {
      const response = await fetch(source.url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'User-Agent': 'ArenaPressFeed/1.0 (+https://political-arena.rblake2320.workers.dev)' },
      });
      if (!response.ok) {
        console.error(`Press feed ${source.label}: HTTP ${response.status}`);
        continue;
      }
      const xml = await response.text();
      const { channelTitle, items } = parseRssItems(xml);
      const publisher = (channelTitle || source.label).slice(0, 200);

      const statements = [];
      for (const item of items) {
        const contentHash = await hashText(`${source.label}:${item.url}:${item.title}`);
        statements.push(
          env.ARENA_DB.prepare(
            `INSERT INTO press_feed_items (id, source, source_type, title, url, publisher, section, published_at, content_hash)
             VALUES (?, ?, 'news', ?, ?, ?, ?, ?, ?)
             ON CONFLICT(url) DO UPDATE SET
               last_seen_at = datetime('now'),
               change_status = CASE WHEN press_feed_items.title != excluded.title THEN 'updated' ELSE press_feed_items.change_status END,
               title = excluded.title,
               updated_at = datetime('now')`
          ).bind(
            `pressfeed-${contentHash.slice(0, 24)}`,
            source.label,
            item.title,
            item.url,
            publisher,
            item.section,
            item.published_at,
            contentHash,
          )
        );
      }
      if (statements.length > 0) {
        await env.ARENA_DB.batch(statements);
        ingested += statements.length;
      }
    } catch (err) {
      console.error(`Press feed ${source.label} ingestion failed:`, err);
    }
  }
  return { ingested, sources: sources.length };
}
