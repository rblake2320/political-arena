/**
 * Arena — Recites Routes
 * Source-backed citations for claims and responses.
 */

import { Router } from 'itty-router';
import { generateId } from '../db.js';
import { auditLog } from '../audit.js';
import { requireAuth, requireRole, errorResponse, successResponse, parseBody, parsePagination } from '../middleware.js';
import { validate, createReciteSchema, reviewReciteSchema } from '../validation.js';
import { checkRateLimit } from '../ratelimit.js';

const router = Router({ base: '/api/recites' });
const RECITE_CONTENT_TYPES = new Set(['ad', 'rebuttal', 'challenge', 'challenge_response']);
const RECITE_MAX_PER_USER = 20;
const RECITE_WINDOW_SECONDS = 60 * 60;

const SOURCE_WEIGHTS = {
  official_record: 1.4,
  court_record: 1.3,
  public_document: 1.25,
  research: 1.2,
  news: 1.0,
  campaign_material: 0.75,
  other: 0.6,
};

const STATUS_WEIGHTS = {
  verified: 1.4,
  pending: 0.6,
  rejected: 0,
};

async function reciteTargetExists(env, contentType, contentId) {
  if (contentType === 'ad') {
    return !!(await env.ARENA_DB.prepare(
      `SELECT id FROM ad_flights WHERE id = ? AND status IN ('approved','active','completed')`
    ).bind(contentId).first());
  }
  if (contentType === 'rebuttal') {
    return !!(await env.ARENA_DB.prepare(
      `SELECT id FROM rebuttal_ads WHERE id = ? AND status IN ('approved','active','completed')`
    ).bind(contentId).first());
  }
  if (contentType === 'challenge') {
    return !!(await env.ARENA_DB.prepare(
      `SELECT id FROM challenges WHERE id = ? AND is_visible = 1`
    ).bind(contentId).first());
  }
  if (contentType === 'challenge_response') {
    return !!(await env.ARENA_DB.prepare(
      `SELECT cr.id
       FROM challenge_responses cr
       JOIN challenges ch ON cr.challenge_id = ch.id
       WHERE cr.id = ? AND ch.is_visible = 1`
    ).bind(contentId).first());
  }
  return false;
}

export function computeFactScore(recites) {
  let support = 0;
  let refute = 0;
  let context = 0;
  let verified_count = 0;
  let pending_count = 0;

  for (const recite of recites) {
    if (recite.status === 'rejected') continue;
    const sourceWeight = SOURCE_WEIGHTS[recite.source_type] || SOURCE_WEIGHTS.other;
    const statusWeight = STATUS_WEIGHTS[recite.status] || STATUS_WEIGHTS.pending;
    const points = 10 * sourceWeight * statusWeight;

    if (recite.status === 'verified') verified_count += 1;
    if (recite.status === 'pending') pending_count += 1;
    if (recite.stance === 'supports') support += points;
    if (recite.stance === 'refutes') refute += points;
    if (recite.stance === 'context') context += points * 0.35;
  }

  const rawScore = 50 + support - refute;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const confidence = Math.max(0, Math.min(100, Math.round(((support + refute + context) / 80) * 100)));
  const label = confidence < 15
    ? 'under-recited'
    : Math.abs(support - refute) < 8
      ? 'mixed'
      : support > refute
        ? 'source-supported'
        : 'source-disputed';

  return {
    score,
    label,
    confidence,
    support_weight: Number(support.toFixed(2)),
    refute_weight: Number(refute.toFixed(2)),
    context_weight: Number(context.toFixed(2)),
    verified_count,
    pending_count,
  };
}

export async function getRecitesForContent(db, contentType, contentId, includeRejected = false) {
  const sql = `
    SELECT r.*, u.display_name as author_name
    FROM recites r
    JOIN users u ON r.user_id = u.id
    WHERE r.content_type = ? AND r.content_id = ?
      ${includeRejected ? '' : "AND r.status != 'rejected'"}
    ORDER BY
      CASE r.status WHEN 'verified' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
      r.created_at DESC
  `;
  const result = await db.prepare(sql).bind(contentType, contentId).all();
  return result.results || [];
}

// GET /api/recites?content_type=ad&content_id=...
router.get('/', async (request, env) => {
  const url = new URL(request.url);
  const contentType = url.searchParams.get('content_type');
  const contentId = url.searchParams.get('content_id');
  if (!contentType || !contentId) return errorResponse('content_type and content_id required');
  if (!RECITE_CONTENT_TYPES.has(contentType)) return errorResponse('Invalid content_type', 400);

  const targetExists = await reciteTargetExists(env, contentType, contentId);
  if (!targetExists) return errorResponse('Recite target not found', 404);

  const recites = await getRecitesForContent(env.ARENA_DB, contentType, contentId);
  return successResponse({
    recites,
    fact_score: computeFactScore(recites),
  });
});

// GET /api/recites/pending — Moderator/admin review queue
router.get('/pending', async (request, env) => {
  const authError = await requireRole('moderator', 'admin', 'super_admin')(request, env);
  if (authError) return authError;

  const url = new URL(request.url);
  const { limit, offset } = parsePagination(url);
  const status = url.searchParams.get('status') || 'pending';
  if (!['pending', 'verified', 'rejected'].includes(status)) return errorResponse('Invalid status', 400);

  const result = await env.ARENA_DB.prepare(
    `SELECT r.*, u.display_name as author_name
     FROM recites r
     JOIN users u ON r.user_id = u.id
     WHERE r.status = ?
     ORDER BY r.created_at ASC
     LIMIT ? OFFSET ?`
  ).bind(status, limit, offset).all();

  const count = await env.ARENA_DB.prepare(
    `SELECT COUNT(*) as total FROM recites WHERE status = ?`
  ).bind(status).first();

  return successResponse({
    recites: result.results || [],
    total: count.total,
    page: Math.floor(offset / limit) + 1,
    limit,
  });
});

// POST /api/recites — Add a source-backed recite
router.post('/', async (request, env, ctx) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const rateLimit = await checkRateLimit(env.ARENA_DB, `recites:user:${request.user.id}`, RECITE_MAX_PER_USER, RECITE_WINDOW_SECONDS);
  if (rateLimit.limited) return errorResponse('Too many recites. Please try again later.', 429);

  const body = await parseBody(request);
  const { valid, errors, data } = validate(createReciteSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  const targetExists = await reciteTargetExists(env, data.content_type, data.content_id);
  if (!targetExists) return errorResponse('Recite target not found', 404);

  const reciteId = generateId('rec');
  try {
    await env.ARENA_DB.prepare(
      `INSERT INTO recites
       (id, content_type, content_id, user_id, url, title, publisher, source_type, stance, claim_text, quote,
        source_published_at, accessed_at, archive_url, evidence_media_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      reciteId,
      data.content_type,
      data.content_id,
      request.user.id,
      data.url,
      data.title,
      data.publisher || null,
      data.source_type,
      data.stance,
      data.claim_text || null,
      data.quote || null,
      data.source_published_at || null,
      data.accessed_at || new Date().toISOString(),
      data.archive_url || null,
      data.evidence_media_url || null,
    ).run();
  } catch (e) {
    if (String(e?.message || e).includes('UNIQUE')) return errorResponse('You already added this recite', 409);
    throw e;
  }

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: 'recite.create',
    entityType: 'recite',
    entityId: reciteId,
    afterState: { content_type: data.content_type, content_id: data.content_id, stance: data.stance, source_type: data.source_type },
  });

  return successResponse({ id: reciteId, status: 'pending' });
});

// PUT /api/recites/:id/review — Moderator/admin verifies or rejects a recite
router.put('/:id/review', async (request, env, ctx) => {
  const authError = await requireRole('moderator', 'admin', 'super_admin')(request, env);
  if (authError) return authError;

  const body = await parseBody(request);
  const { valid, errors, data } = validate(reviewReciteSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  const { id } = request.params;
  const existing = await env.ARENA_DB.prepare(`SELECT * FROM recites WHERE id = ?`).bind(id).first();
  if (!existing) return errorResponse('Recite not found', 404);

  await env.ARENA_DB.prepare(
    `UPDATE recites
     SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), review_note = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).bind(data.status, request.user.id, data.review_note || null, id).run();

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: 'recite.review',
    entityType: 'recite',
    entityId: id,
    beforeState: { status: existing.status },
    afterState: { status: data.status, review_note: data.review_note || null },
  });

  return successResponse({ id, status: data.status });
});

// DELETE /api/recites/:id — Owner can remove their own pending/visible recite
router.delete('/:id', async (request, env) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const { id } = request.params;
  const recite = await env.ARENA_DB.prepare(
    `SELECT id FROM recites WHERE id = ? AND user_id = ?`
  ).bind(id, request.user.id).first();
  if (!recite) return errorResponse('Recite not found', 404);

  await env.ARENA_DB.prepare(`DELETE FROM recites WHERE id = ?`).bind(id).run();
  return successResponse({ deleted: true });
});

export default router;
