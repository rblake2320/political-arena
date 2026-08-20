/**
 * Arena — Political Messaging Platform
 * Cloudflare Worker Entry Point
 *
 * Modular architecture: routes split into separate files,
 * bundled by Cloudflare at deploy time (zero runtime cost).
 */

import { Router } from 'itty-router';
import { initDatabase, seedIssueCategories, seedPressFeedItems, seedOutsideAdExamples, seedDemoData } from './db.js';
import { ingestPressFeeds } from './press-ingest.js';
import { archiveAndPurge } from './archive.js';
import { corsHeaders, json } from './middleware.js';
import { r2MediaResponse } from './media.js';
import { HTML_CSP } from './csp.js';

// Route modules
import authRoutes from './routes/auth.routes.js';
import usersRoutes from './routes/users.routes.js';
import racesRoutes from './routes/races.routes.js';
import candidatesRoutes from './routes/candidates.routes.js';
import adsRoutes from './routes/ads.routes.js';
import challengesRoutes from './routes/challenges.routes.js';
import reactionsRoutes from './routes/reactions.routes.js';
import recitesRoutes from './routes/recites.routes.js';
import statementsRoutes from './routes/statements.routes.js';
import notificationsRoutes from './routes/notifications.routes.js';
import surveysRoutes from './routes/surveys.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import uploadsRoutes from './routes/uploads.routes.js';
import auditRoutes from './routes/audit.routes.js';
import questionsRoutes from './routes/questions.routes.js';
import pressRoutes from './routes/press.routes.js';
import creditsRoutes from './routes/credits.routes.js';
import statsRoutes from './routes/stats.routes.js';
import correctionsRoutes from './routes/corrections.routes.js';
import electionsRoutes from './routes/elections.routes.js';
import favoritesRoutes from './routes/favorites.routes.js';
import safetyRoutes from './routes/safety.routes.js';
import moderationRoutes from './routes/moderation.routes.js';

// Main API router
const api = Router({ base: '/api' });

// Mount route modules
api.all('/auth/*', authRoutes.fetch);
api.all('/users/*', usersRoutes.fetch);
api.all('/races/*', racesRoutes.fetch);
api.all('/candidates/*', candidatesRoutes.fetch);
api.all('/ads/*', adsRoutes.fetch);
api.all('/challenges/*', challengesRoutes.fetch);
api.all('/reactions/*', reactionsRoutes.fetch);
api.all('/recites/*', recitesRoutes.fetch);
api.all('/statements/*', statementsRoutes.fetch);
api.all('/notifications/*', notificationsRoutes.fetch);
api.all('/surveys/*', surveysRoutes.fetch);
api.all('/analytics/*', analyticsRoutes.fetch);
api.all('/uploads/*', uploadsRoutes.fetch);
api.all('/audit/*', auditRoutes.fetch);
api.all('/questions/*', questionsRoutes.fetch);
api.all('/press/*', pressRoutes.fetch);
api.all('/credits/*', creditsRoutes.fetch);
api.all('/stats/*', statsRoutes.fetch);
api.all('/feed/*', statsRoutes.fetch);
api.all('/corrections/*', correctionsRoutes.fetch);
api.all('/elections/*', electionsRoutes.fetch);
api.all('/favorites/*', favoritesRoutes.fetch);
api.all('/safety/*', safetyRoutes.fetch);
api.all('/moderation/*', moderationRoutes.fetch);

// Health check fallback; fetch() handles /api/health directly so bootstrap
// failures can return degraded health before route dispatch.
api.get('/health', () => json({ status: 'ok', database: 'ok', version: '1.0.0', timestamp: new Date().toISOString() }));

// 404 for unknown API routes
api.all('*', () => json({ success: false, error: 'API endpoint not found' }, 404));

// Security headers applied to every response served by the worker
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
};

// HTML CSP lives in csp.js — workerd rejects non-handler exports from the entry module.

function withSecurityHeaders(response, { isHtml = false } = {}) {
  const headers = new Headers(response.headers);
  Object.entries(SECURITY_HEADERS).forEach(([k, v]) => headers.set(k, v));
  if (isHtml) headers.set('Content-Security-Policy', HTML_CSP);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function withApiHeaders(response, request, env) {
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders(request, env)).forEach(([k, v]) => headers.set(k, v));
  Object.entries(SECURITY_HEADERS).forEach(([k, v]) => headers.set(k, v));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// One-time bootstrap per isolate: schema + reference data. Demo data only
// seeds outside production (or when SEED_DEMO_DATA=true is set explicitly) —
// production databases must never receive fictional candidates or ads.
const bootstrappedDbs = new WeakSet();
async function bootstrap(env) {
  if (bootstrappedDbs.has(env.ARENA_DB)) return;
  await initDatabase(env.ARENA_DB);
  await seedIssueCategories(env.ARENA_DB);
  if (env.ENVIRONMENT !== 'production' || env.SEED_DEMO_DATA === 'true') {
    await seedPressFeedItems(env.ARENA_DB);
    await seedOutsideAdExamples(env.ARENA_DB);
    await seedDemoData(env.ARENA_DB);
  } else {
    // Production cleanup: earlier builds seeded sample historical ads
    // (public-domain Daisy/Ike clips) attributed to real FEC candidates.
    // Fabricated ad activity must never appear on a production ledger.
    await env.ARENA_DB.batch([
      env.ARENA_DB.prepare(
        `DELETE FROM rebuttal_ads WHERE parent_ad_id IN ('ad-ext-roy-cooper-easier-2026', 'ad-ext-andy-barr-stop-dei-2026')`
      ),
      env.ARENA_DB.prepare(
        `DELETE FROM ad_flights WHERE id IN ('ad-ext-roy-cooper-easier-2026', 'ad-ext-andy-barr-stop-dei-2026')`
      ),
    ]);
  }
  bootstrappedDbs.add(env.ARENA_DB);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return withApiHeaders(new Response(null, { status: 204 }), request, env);
    }

    // Initialize database once per isolate
    let bootstrapError = null;
    try {
      await bootstrap(env);
    } catch (err) {
      console.error('DB init error:', err);
      bootstrapError = err;
    }

    if (url.pathname === '/api/health') {
      return withApiHeaders(json({
        status: bootstrapError ? 'degraded' : 'ok',
        database: bootstrapError ? 'error' : 'ok',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
      }, bootstrapError ? 503 : 200), request, env);
    }

    // API routes
    if (url.pathname.startsWith('/api/')) {
      if (bootstrapError) {
        return withApiHeaders(json({ success: false, error: 'Service unavailable' }, 503), request, env);
      }

      try {
        const response = await api.fetch(request, env, ctx);
        return withApiHeaders(response, request, env);
      } catch (err) {
        console.error('API error:', err);
        return withApiHeaders(json({ success: false, error: 'Internal server error' }, 500), request, env);
      }
    }

    // robots.txt + sitemap.xml — voters find candidates through search
    if (url.pathname === '/robots.txt') {
      return new Response(`User-agent: *\nAllow: /\nSitemap: ${url.origin}/sitemap.xml\n`, {
        headers: { 'Content-Type': 'text/plain' },
      });
    }
    if (url.pathname === '/sitemap.xml') {
      const staticPaths = ['/', '/what-matters', '/help', '/press/register', '/terms', '/privacy', '/moderation-policy', '/dmca'];
      let urls = staticPaths.map(p => `${url.origin}${p}`);
      try {
        const [races, challenges] = await Promise.all([
          env.ARENA_DB.prepare(`SELECT id FROM races WHERE status IN ('upcoming','active','voting') ORDER BY id LIMIT 1000`).all(),
          env.ARENA_DB.prepare(`SELECT COALESCE(public_receipt_slug, id) as slug FROM challenges WHERE is_visible = 1 ORDER BY created_at DESC LIMIT 1000`).all(),
        ]);
        urls = urls.concat((races.results || []).map(r => `${url.origin}/race/${r.id}`));
        urls = urls.concat((challenges.results || []).map(c => `${url.origin}/challenge/${c.slug}`));
      } catch { /* serve the static portion regardless */ }
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        urls.map(u => `  <url><loc>${u.replace(/&/g, '&amp;')}</loc></url>`).join('\n') + `\n</urlset>`;
      return new Response(xml, { headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600' } });
    }

    // Serve media files from R2
    if (url.pathname.startsWith('/media/')) {
      if (!env.ARENA_MEDIA) {
        return withApiHeaders(json({ success: false, error: 'Media storage not available' }, 503), request, env);
      }
      const key = url.pathname.slice(7); // strip leading "/media/"
      if (!key || !key.startsWith('uploads/')) {
        return withApiHeaders(json({ success: false, error: 'Invalid media path' }, 403), request, env);
      }
      const response = await r2MediaResponse(env.ARENA_MEDIA, key, request);
      if (!response) {
        return new Response('Not Found', { status: 404 });
      }
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', "default-src 'none'");
      Object.entries(SECURITY_HEADERS).forEach(([k, v]) => headers.set(k, v));
      // Add CORS headers (same allowlist as API)
      Object.entries(corsHeaders(request, env)).forEach(([k, v]) => headers.set(k, v));
      return new Response(response.body, { status: response.status, headers });
    }

    // Serve static assets (the React SPA)
    try {
      const response = await env.ASSETS.fetch(request);

      // Crawler-visible metadata: receipt and race pages get real titles/OG
      // tags injected into the SPA shell so shared links render cards.
      const receiptMatch = url.pathname.match(/^\/challenge\/([^/]+)$/);
      const raceMatch = url.pathname.match(/^\/race\/([^/]+)$/);
      if ((receiptMatch || raceMatch) && (response.status === 200 || response.status === 404)) {
        try {
          let title = null;
          let description = null;
          if (receiptMatch) {
            const ch = await env.ARENA_DB.prepare(
              `SELECT ch.claim_text, ch.challenge_text, ch.status, cc.name as challenger, tc.name as target
               FROM challenges ch
               JOIN candidates cc ON cc.id = ch.challenger_candidate_id
               JOIN candidates tc ON tc.id = ch.target_candidate_id
               WHERE (ch.id = ? OR ch.public_receipt_slug = ?) AND ch.is_visible = 1`
            ).bind(receiptMatch[1], receiptMatch[1]).first();
            if (ch) {
              title = `${ch.challenger} calls out ${ch.target} — Public Callout Receipt`;
              description = (ch.claim_text || ch.challenge_text || '').slice(0, 200);
            }
          } else if (raceMatch) {
            const race = await env.ARENA_DB.prepare(`SELECT name, state, office FROM races WHERE id = ?`).bind(raceMatch[1]).first();
            if (race) {
              title = `${race.name} — Political Arena`;
              description = `Ads, rebuttals, fact-check callouts, and voter questions for the ${race.name}, on the public record.`;
            }
          }
          if (title) {
            const shell = response.status === 200 ? response : await env.ASSETS.fetch(new Request(new URL('/', request.url), request));
            const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
            const rewritten = new HTMLRewriter()
              .on('title', { element(el) { el.setInnerContent(title); } })
              // strip the shell's generic tags so crawlers see only the
              // page-specific ones (they take the first occurrence)
              .on('meta[property="og:title"]', { element(el) { el.remove(); } })
              .on('meta[property="og:description"]', { element(el) { el.remove(); } })
              .on('meta[name="description"]', { element(el) { el.remove(); } })
              .on('meta[name="twitter:card"]', { element(el) { el.remove(); } })
              .on('head', { element(el) {
                el.append(`<meta name="description" content="${esc(description)}">` +
                  `<meta property="og:title" content="${esc(title)}">` +
                  `<meta property="og:description" content="${esc(description)}">` +
                  `<meta property="og:type" content="article">` +
                  `<meta property="og:url" content="${esc(url.origin + url.pathname)}">` +
                  `<meta property="og:site_name" content="Political Arena">` +
                  `<meta name="twitter:card" content="summary">`, { html: true });
              } })
              .transform(shell);
            return withSecurityHeaders(new Response(rewritten.body, { status: 200, headers: shell.headers }), { isHtml: true });
          }
        } catch (err) {
          console.error('Meta injection failed:', err);
        }
      }
      if (response.status === 404) {
        // SPA fallback: serve index.html for client-side routing
        const indexRequest = new Request(new URL('/', request.url), request);
        const indexResponse = await env.ASSETS.fetch(indexRequest);
        return withSecurityHeaders(indexResponse, { isHtml: true });
      }
      const isHtml = (response.headers.get('Content-Type') || '').includes('text/html');
      return withSecurityHeaders(response, { isHtml });
    } catch (e) {
      return new Response('Internal Server Error', { status: 500 });
    }
  },

  // Cron handler — challenge expiration, ad lifecycle, analytics rollups
  async scheduled(event, env, ctx) {
    console.log('Cron trigger fired:', event.cron);

    try {
      await initDatabase(env.ARENA_DB);

      // 1. Expire open challenges past deadline
      const expired = await env.ARENA_DB.prepare(
        `UPDATE challenges SET status = 'expired', expired_at = datetime('now'), updated_at = datetime('now')
         WHERE status = 'open'
           AND notice_status != 'unserved'
           AND response_deadline < datetime('now')`
      ).run();
      if (expired.meta?.changes > 0) {
        console.log(`Expired ${expired.meta.changes} challenges`);
      }

      // 1b. Close out unserved challenges 7 days past deadline. The target
      // never received notice (unclaimed candidate), so the challenge can
      // never resolve — expire it (the receipt keeps notice_status='unserved'
      // for context) and refund the challenger's credit, since the platform
      // could not deliver the accountability action they paid for.
      const unservedExpired = await env.ARENA_DB.batch([
        env.ARENA_DB.prepare(
          `UPDATE candidates SET credit_balance = credit_balance + (
             SELECT COUNT(*) FROM challenges
             WHERE challenger_candidate_id = candidates.id
               AND status = 'open' AND notice_status = 'unserved'
               AND response_deadline < datetime('now', '-7 days'))
           WHERE id IN (
             SELECT challenger_candidate_id FROM challenges
             WHERE status = 'open' AND notice_status = 'unserved'
               AND response_deadline < datetime('now', '-7 days'))`
        ),
        env.ARENA_DB.prepare(
          `INSERT INTO credit_transactions (id, candidate_id, amount, transaction_type, description, reference_id)
           SELECT lower(hex(randomblob(8))), challenger_candidate_id, 1, 'refund', 'Callout notice never served — credit refunded', id
           FROM challenges
           WHERE status = 'open' AND notice_status = 'unserved'
             AND response_deadline < datetime('now', '-7 days')`
        ),
        env.ARENA_DB.prepare(
          `UPDATE challenges SET status = 'expired', expired_at = datetime('now'), updated_at = datetime('now')
           WHERE status = 'open' AND notice_status = 'unserved'
             AND response_deadline < datetime('now', '-7 days')`
        ),
      ]);
      const unservedCount = unservedExpired[2]?.meta?.changes || 0;
      if (unservedCount > 0) {
        console.log(`Expired ${unservedCount} unserved challenges with credit refunds`);
      }

      // 2. Activate approved ads whose start_date has arrived
      await env.ARENA_DB.prepare(
        `UPDATE ad_flights SET status = 'active', activated_at = datetime('now'), updated_at = datetime('now')
         WHERE status = 'approved' AND start_date IS NOT NULL AND start_date <= datetime('now')`
      ).run();

      // 3. Complete active ads whose end_date has passed
      await env.ARENA_DB.prepare(
        `UPDATE ad_flights SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now')
         WHERE status = 'active' AND end_date IS NOT NULL AND end_date <= datetime('now')`
      ).run();

      // 4. Clean expired sessions
      await env.ARENA_DB.prepare(
        `UPDATE sessions SET is_active = 0 WHERE is_active = 1 AND expires_at < datetime('now')`
      ).run();

      // 5+6. Archive-then-purge aged analytics events and impression logs.
      // Rows are exported to R2 (archives/<table>/...ndjson) BEFORE deletion;
      // if archiving fails, nothing is deleted — data is never destroyed.
      const parsedRetention = Number.parseInt(env.IMPRESSION_LOG_RETENTION_DAYS || '30', 10);
      const retentionDays = Number.isFinite(parsedRetention) && parsedRetention >= 1 ? parsedRetention : 30;
      const retentionModifier = `-${retentionDays} days`;
      for (const table of ['analytics_events', 'impression_logs']) {
        const result = await archiveAndPurge(env, { table, cutoffModifier: retentionModifier })
          .catch(err => { console.error(`Archive of ${table} failed (rows retained):`, err); return null; });
        if (result?.archived > 0) {
          console.log(`Archived ${result.archived} ${table} rows to R2 before purge`);
        }
      }

      // 7. Clean expired cooldowns
      await env.ARENA_DB.prepare(
        `DELETE FROM challenge_cooldowns WHERE cooldown_until < datetime('now')`
      ).run();

      // 8. Reap expired rate-limit windows
      await env.ARENA_DB.prepare(
        `DELETE FROM auth_rate_limits WHERE reset_at < datetime('now')`
      ).run();

      // 9. Hard-delete long-inactive sessions (kept 30 days for audit trails)
      await env.ARENA_DB.prepare(
        `DELETE FROM sessions WHERE is_active = 0 AND expires_at < datetime('now', '-30 days')`
      ).run();

      // 10. Refresh the public press feed from configured RSS sources
      const pressResult = await ingestPressFeeds(env);
      if (pressResult.sources > 0) {
        console.log(`Press feed: ${pressResult.ingested} items across ${pressResult.sources} sources`);
      }

    } catch (err) {
      console.error('Cron error:', err);
    }
  },
};
