/**
 * Arena — Political Messaging Platform
 * Cloudflare Worker Entry Point
 *
 * Modular architecture: routes split into separate files,
 * bundled by Cloudflare at deploy time (zero runtime cost).
 */

import { Router } from 'itty-router';
import { initDatabase, seedIssueCategories, seedPressFeedItems, seedOutsideAdExamples, seedDemoData } from './db.js';
import { corsHeaders, json } from './middleware.js';
import { r2MediaResponse } from './media.js';

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

// CSP for HTML documents (the React SPA). Media/images may come from R2 or
// external https hosts (e.g. campaign photo CDNs), so img/media allow https.
// The redesign imports Google Fonts; keep that allowance explicit instead of
// widening all style/font sources.
const HTML_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' https: data: blob:",
  "media-src 'self' https: blob:",
  "connect-src 'self'",
  "font-src 'self' data: https://fonts.gstatic.com",
  "object-src 'none'",
  "frame-src 'self' https://www.youtube-nocookie.com https://player.vimeo.com",
  "child-src 'self' https://www.youtube-nocookie.com https://player.vimeo.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function withSecurityHeaders(response, { isHtml = false } = {}) {
  const headers = new Headers(response.headers);
  Object.entries(SECURITY_HEADERS).forEach(([k, v]) => headers.set(k, v));
  if (isHtml) headers.set('Content-Security-Policy', HTML_CSP);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function withApiHeaders(response, request) {
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders(request)).forEach(([k, v]) => headers.set(k, v));
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
  await seedPressFeedItems(env.ARENA_DB);
  await seedOutsideAdExamples(env.ARENA_DB);
  if (env.ENVIRONMENT !== 'production' || env.SEED_DEMO_DATA === 'true') {
    await seedDemoData(env.ARENA_DB);
  }
  bootstrappedDbs.add(env.ARENA_DB);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return withApiHeaders(new Response(null, { status: 204 }), request);
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
      }, bootstrapError ? 503 : 200), request);
    }

    // API routes
    if (url.pathname.startsWith('/api/')) {
      if (bootstrapError) {
        return withApiHeaders(json({ success: false, error: 'Service unavailable' }, 503), request);
      }

      try {
        const response = await api.fetch(request, env, ctx);
        return withApiHeaders(response, request);
      } catch (err) {
        console.error('API error:', err);
        return withApiHeaders(json({ success: false, error: 'Internal server error' }, 500), request);
      }
    }

    // Serve media files from R2
    if (url.pathname.startsWith('/media/')) {
      if (!env.ARENA_MEDIA) {
        return json({ success: false, error: 'Media storage not available' }, 503);
      }
      const key = url.pathname.slice(7); // strip leading "/media/"
      if (!key || !key.startsWith('uploads/')) {
        return json({ success: false, error: 'Invalid media path' }, 403);
      }
      const response = await r2MediaResponse(env.ARENA_MEDIA, key, request);
      if (!response) {
        return new Response('Not Found', { status: 404 });
      }
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', "default-src 'none'");
      Object.entries(SECURITY_HEADERS).forEach(([k, v]) => headers.set(k, v));
      // Add CORS headers (same allowlist as API)
      Object.entries(corsHeaders(request)).forEach(([k, v]) => headers.set(k, v));
      return new Response(response.body, { status: response.status, headers });
    }

    // Serve static assets (the React SPA)
    try {
      const response = await env.ASSETS.fetch(request);
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
         WHERE status = 'open' AND response_deadline < datetime('now')`
      ).run();
      if (expired.meta?.changes > 0) {
        console.log(`Expired ${expired.meta.changes} challenges`);
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

      // 5. Purge old analytics events (default 30-day retention)
      const parsedRetention = Number.parseInt(env.IMPRESSION_LOG_RETENTION_DAYS || '30', 10);
      const retentionDays = Number.isFinite(parsedRetention) && parsedRetention >= 1 ? parsedRetention : 30;
      const retentionModifier = `-${retentionDays} days`;
      await env.ARENA_DB.prepare(
        `DELETE FROM analytics_events WHERE created_at < datetime('now', ?)`
      ).bind(retentionModifier).run();

      // 6. Purge old impression logs
      await env.ARENA_DB.prepare(
        `DELETE FROM impression_logs WHERE created_at < datetime('now', ?)`
      ).bind(retentionModifier).run();

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

    } catch (err) {
      console.error('Cron error:', err);
    }
  },
};
