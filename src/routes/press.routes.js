/**
 * Arena — Press Credential Routes
 * Register, check status, admin review
 */

import { Router } from 'itty-router';
import { generateId } from '../db.js';
import { auditLog } from '../audit.js';
import {
  requireAuth, requireRole, successResponse, errorResponse, parseBody, getClientIP,
} from '../middleware.js';
import { validate, registerPressSchema, pressNewsSourceSchema } from '../validation.js';

const router = Router({ base: '/api/press' });

function normalizeSourceUrl(value) {
  const parsed = new URL(value.trim());
  parsed.hash = '';
  return parsed.toString();
}

function presentSource(source) {
  return {
    ...source,
    is_default: source.source_scope === 'default',
  };
}

/**
 * GET /api/press/feed — Public source-link feed for press/public updates
 */
router.get('/feed', async (request, env) => {
  const url = new URL(request.url);
  const rawLimit = parseInt(url.searchParams.get('limit') || '12', 10);
  const limit = Math.min(50, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 12));
  const source = url.searchParams.get('source');
  const section = url.searchParams.get('section');

  let sql = `SELECT
      id,
      source,
      source_type,
      title,
      url,
      publisher,
      section,
      published_at,
      first_seen_at,
      last_seen_at,
      change_status
    FROM press_feed_items
    WHERE is_active = 1`;
  const binds = [];

  if (source) {
    sql += ` AND source = ?`;
    binds.push(source);
  }
  if (section) {
    sql += ` AND section = ?`;
    binds.push(section);
  }

  sql += ` ORDER BY COALESCE(published_at, first_seen_at) DESC, first_seen_at DESC LIMIT ?`;
  binds.push(limit);

  const [itemsResult, sourcesResult] = await Promise.all([
    env.ARENA_DB.prepare(sql).bind(...binds).all(),
    env.ARENA_DB.prepare(
      `SELECT source, publisher, section, COUNT(*) as item_count
       FROM press_feed_items
       WHERE is_active = 1
       GROUP BY source, publisher, section
       ORDER BY publisher ASC, section ASC`
    ).all(),
  ]);

  return successResponse({
    items: itemsResult.results || [],
    sources: sourcesResult.results || [],
    limit,
  });
});

/**
 * POST /api/press/register — Submit press credentials
 */
router.post('/register', async (request, env) => {
  const authErr = await requireAuth(request, env);
  if (authErr) return authErr;

  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid JSON body');

  const { valid, errors, data } = validate(registerPressSchema, body);
  if (!valid) return errorResponse(errors.join(', '));

  // Check for existing credential
  const existing = await env.ARENA_DB.prepare(
    `SELECT id, status FROM press_credentials WHERE user_id = ?`
  ).bind(request.user.id).first();

  if (existing) {
    if (existing.status === 'approved') return errorResponse('You already have approved press credentials', 409);
    if (existing.status === 'pending') return errorResponse('You already have a pending application', 409);
    // If rejected, allow re-application by updating
    await env.ARENA_DB.prepare(
      `UPDATE press_credentials SET outlet_name = ?, outlet_type = ?, proof_url = ?, status = 'pending', reviewed_by = NULL, reviewed_at = NULL WHERE id = ?`
    ).bind(data.outlet_name, data.outlet_type, data.proof_url || null, existing.id).run();
    return successResponse({ id: existing.id, status: 'pending', reapplication: true });
  }

  const id = generateId('pc');
  await env.ARENA_DB.prepare(
    `INSERT INTO press_credentials (id, user_id, outlet_name, outlet_type, proof_url) VALUES (?, ?, ?, ?, ?)`
  ).bind(id, request.user.id, data.outlet_name, data.outlet_type, data.proof_url || null).run();

  return successResponse({ id, status: 'pending' });
});

/**
 * GET /api/press/my-status — Check own press credential status
 */
router.get('/my-status', async (request, env) => {
  const authErr = await requireAuth(request, env);
  if (authErr) return authErr;

  const cred = await env.ARENA_DB.prepare(
    `SELECT id, outlet_name, outlet_type, proof_url, status, reviewed_at, created_at FROM press_credentials WHERE user_id = ?`
  ).bind(request.user.id).first();

  return successResponse({ credential: cred || null });
});

/**
 * GET /api/press/sources — Preloaded + user-tracked news sources
 */
router.get('/sources', async (request, env) => {
  const authErr = await requireAuth(request, env);
  if (authErr) return authErr;

  const sources = await env.ARENA_DB.prepare(
    `SELECT id, user_id, name, url, description, source_scope, created_at, updated_at
     FROM press_news_sources
     WHERE is_active = 1
       AND (source_scope = 'default' OR user_id = ?)
     ORDER BY
       CASE source_scope WHEN 'default' THEN 0 ELSE 1 END,
       name ASC`
  ).bind(request.user.id).all();

  return successResponse({ sources: (sources.results || []).map(presentSource) });
});

/**
 * POST /api/press/sources — Add a user-tracked news source
 */
router.post('/sources', async (request, env) => {
  const authErr = await requireAuth(request, env);
  if (authErr) return authErr;

  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid JSON body');

  const { valid, errors, data } = validate(pressNewsSourceSchema, body);
  if (!valid) return errorResponse(errors.join(', '));

  const normalizedUrl = normalizeSourceUrl(data.url);
  const defaultSource = await env.ARENA_DB.prepare(
    `SELECT id, user_id, name, url, description, source_scope, created_at, updated_at
     FROM press_news_sources
     WHERE source_scope = 'default' AND url = ? AND is_active = 1`
  ).bind(normalizedUrl).first();

  if (defaultSource) {
    return successResponse({ source: presentSource(defaultSource), already_preloaded: true });
  }

  const id = generateId('psrc');
  await env.ARENA_DB.prepare(
    `INSERT INTO press_news_sources (id, user_id, name, url, description, source_scope, is_active)
     VALUES (?, ?, ?, ?, ?, 'user', 1)
     ON CONFLICT(user_id, url) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       is_active = 1,
       updated_at = datetime('now')`
  ).bind(id, request.user.id, data.name, normalizedUrl, data.description || null).run();

  const source = await env.ARENA_DB.prepare(
    `SELECT id, user_id, name, url, description, source_scope, created_at, updated_at
     FROM press_news_sources
     WHERE user_id = ? AND url = ? AND is_active = 1`
  ).bind(request.user.id, normalizedUrl).first();

  return successResponse({ source: presentSource(source) });
});

/**
 * DELETE /api/press/sources/:id — Remove one user-tracked source
 */
router.delete('/sources/:id', async (request, env) => {
  const authErr = await requireAuth(request, env);
  if (authErr) return authErr;

  const source = await env.ARENA_DB.prepare(
    `SELECT id, source_scope, user_id FROM press_news_sources WHERE id = ? AND is_active = 1`
  ).bind(request.params.id).first();

  if (!source) return errorResponse('Source not found', 404);
  if (source.source_scope === 'default') return errorResponse('Preloaded sources cannot be removed', 403);
  if (source.user_id !== request.user.id) return errorResponse('Source not found', 404);

  await env.ARENA_DB.prepare(
    `UPDATE press_news_sources SET is_active = 0, updated_at = datetime('now') WHERE id = ?`
  ).bind(source.id).run();

  return successResponse({ id: source.id, removed: true });
});

/**
 * GET /api/press/pending — List pending press applications (admin/moderator)
 */
router.get('/pending', async (request, env) => {
  const roleCheck = requireRole('admin', 'super_admin', 'moderator');
  const err = await roleCheck(request, env);
  if (err) return err;

  const pending = await env.ARENA_DB.prepare(
    `SELECT pc.*, u.display_name, u.email FROM press_credentials pc JOIN users u ON pc.user_id = u.id WHERE pc.status = 'pending' ORDER BY pc.created_at ASC`
  ).all();

  return successResponse({ applications: pending.results });
});

/**
 * PUT /api/press/:id/review — Approve or reject (admin/moderator)
 * Body: { action: 'approve' | 'reject' }
 */
router.put('/:id/review', async (request, env, ctx) => {
  const roleCheck = requireRole('admin', 'super_admin', 'moderator');
  const err = await roleCheck(request, env);
  if (err) return err;

  const { id } = request.params;
  const body = await parseBody(request);
  if (!body || !['approve', 'reject'].includes(body.action)) {
    return errorResponse('action must be "approve" or "reject"');
  }

  const cred = await env.ARENA_DB.prepare(`SELECT id, user_id, status FROM press_credentials WHERE id = ?`).bind(id).first();
  if (!cred) return errorResponse('Credential not found', 404);

  const newStatus = body.action === 'approve' ? 'approved' : 'rejected';
  await env.ARENA_DB.prepare(
    `UPDATE press_credentials SET status = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`
  ).bind(newStatus, request.user.id, id).run();

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: `press.${body.action}`,
    entityType: 'press_credentials',
    entityId: id,
    beforeState: { status: cred.status },
    afterState: { status: newStatus },
    ipAddress: getClientIP(request),
  });

  return successResponse({ id, status: newStatus });
});

// 404
router.all('*', () => errorResponse('Press endpoint not found', 404));

export default router;
