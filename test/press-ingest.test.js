/**
 * Press feed RSS ingestion — parser and source-config unit tests.
 */
import { describe, it, expect } from 'vitest';
import { parseRssItems, parsePressFeedSources } from '../src/press-ingest.js';

const SAMPLE_RSS = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel>
<title>Politics from Example</title>
<item>
  <guid isPermaLink="true">https://example.com/story/1</guid>
  <title><![CDATA[Senator says the quiet part &amp; more]]></title>
  <link>https://example.com/story/1</link>
  <pubDate>Thu, 20 Aug 2026 04:09:21 GMT</pubDate>
  <category>Politics</category>
</item>
<item>
  <title>No link item — must be skipped</title>
</item>
<item>
  <title>Bad scheme</title>
  <link>javascript:alert(1)</link>
</item>
<item>
  <title>Second valid story</title>
  <link>https://example.com/story/2</link>
  <pubDate>not a real date</pubDate>
</item>
</channel></rss>`;

describe('parseRssItems', () => {
  it('extracts valid items, decodes entities, skips linkless and non-http items', () => {
    const { channelTitle, items } = parseRssItems(SAMPLE_RSS);
    expect(channelTitle).toBe('Politics from Example');
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: 'Senator says the quiet part & more',
      url: 'https://example.com/story/1',
      section: 'Politics',
    });
    expect(items[0].published_at).toBe('2026-08-20T04:09:21.000Z');
    expect(items[1].published_at).toBeNull();
  });

  it('handles empty/garbage input without throwing', () => {
    expect(parseRssItems('').items).toEqual([]);
    expect(parseRssItems('<html>not rss</html>').items).toEqual([]);
  });
});

describe('parsePressFeedSources', () => {
  it('parses label|url pairs and bare urls', () => {
    const sources = parsePressFeedSources('newser|https://rss.newser.com/rss/section/4.rss, https://san.com/feed/');
    expect(sources).toHaveLength(2);
    expect(sources[0]).toEqual({ label: 'newser', url: 'https://rss.newser.com/rss/section/4.rss' });
    expect(sources[1].label).toBe('san.com');
  });

  it('drops malformed entries and empty config', () => {
    expect(parsePressFeedSources('')).toEqual([]);
    expect(parsePressFeedSources(undefined)).toEqual([]);
    expect(parsePressFeedSources('not-a-url, ftp://nope.example')).toEqual([]);
  });
});
