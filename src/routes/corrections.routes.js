/**
 * Arena — Correction / Appeal Routes
 * Public correction path for disputed records and reviewed accountability calls.
 */

import { Router } from 'itty-router';
import { generateId } from '../db.js';
import { auditLogNow } from '../audit.js';
import { requireAuth, requireRole, errorResponse, successResponse, parseBody, parsePagination, getClientIP } from '../middleware.js';
import { validate, createCorrectionRequestSchema, reviewCorrectionRequestSchema } from '../validation.js';

const router = Router({ base: '/api/corrections' });

const CONTENT_TABLES = {
  statement: 'public_statements',
  recite: 'recites',
  challenge: 'challenges',
  challenge_response: 'challenge_responses',
  candidate: 'candidates',
  ad: 'ad_flights',
  rebuttal: 'rebuttal_ads',
};

async function contentTargetExists(db, contentType, contentId) {
  const table = CONTENT_TABLES[contentType];
  if (!table) return false;
  return !!(await db.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(contentId).first());
}

async function insertCorrectionEvent(db, {
  correctionRequestId,
  actorId,
  eventType,
  beforeStatus = null,
  afterStatus = null,
  note = null,
  publicNote = null,
  metadata = null,
}) {
  await db.prepare(
    `INSERT INTO correction_request_events
     (id, correction_request_id, actor_id, event_type, before_status, after_status, note, public_note, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    generateId('crev'),
    correctionRequestId,
    actorId,
    eventType,
    beforeStatus,
    afterStatus,
    note,
    publicNote,
    metadata ? JSON.stringify(metadata) : null,
  ).run();
}

// GET /api/corrections/public?content_type=statement&content_id=...
router.get('/public', async (request, env) => {
  const url = new URL(request.url);
  const contentType = url.searchParams.get('content_type');
  const contentId = url.searchParams.get('content_id');
  if (!contentType || !contentId) return errorResponse('content_type and content_id required');
  if (!CONTENT_TABLES[contentType]) return errorResponse('Invalid content_type', 400);

  const result = await env.ARENA_DB.prepare(
    `SELECT id, content_type, content_id, candidate_id, reason, status, public_note, created_at, reviewed_at
     FROM correction_requests
     WHERE content_type = ? AND content_id = ?
     ORDER BY created_at DESC`
  ).bind(contentType, contentId).all();

  const requestIds = (result.results || []).map(row => row.id);
  let events = [];
  if (requestIds.length > 0) {
    const placeholders = requestIds.map(() => '?').join(',');
    const eventsResult = await env.ARENA_DB.prepare(
      `SELECT correction_request_id, event_type, before_status, after_status, public_note, created_at
       FROM correction_request_events
       WHERE correction_request_id IN (${placeholders})
       ORDER BY created_at ASC`
    ).bind(...requestIds).all();
    events = eventsResult.results || [];
  }

  return successResponse({ corrections: result.results || [], events });
});

// GET /api/corrections/mine — Authenticated user's correction requests
router.get('/mine', async (request, env) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const url = new URL(request.url);
  const { limit, offset } = parsePagination(url);
  const result = await env.ARENA_DB.prepare(
    `SELECT id, content_type, content_id, candidate_id, reason, requested_change, evidence_url,
            status, resolution_note, public_note, reviewed_at, created_at
     FROM correction_requests
     WHERE requester_id = ?
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(request.user.id, limit, offset).all();

  return successResponse({ corrections: result.results || [], page: Math.floor(offset / limit) + 1, limit });
});

// GET /api/corrections/pending — Moderator/admin queue
router.get('/pending', async (request, env) => {
  const authError = await requireRole('moderator', 'admin', 'super_admin')(request, env);
  if (authError) return authError;

  const url = new URL(request.url);
  const { limit, offset } = parsePagination(url);
  const status = url.searchParams.get('status') || 'open';
  if (!['open', 'under_review', 'upheld', 'revised', 'rejected'].includes(status)) {
    return errorResponse('Invalid status', 400);
  }

  const result = await env.ARENA_DB.prepare(
    `SELECT cr.*, u.display_name as requester_name, u.email as requester_email,
            c.name as candidate_name, r.name as race_name, r.state as race_state
     FROM correction_requests cr
     JOIN users u ON u.id = cr.requester_id
     LEFT JOIN candidates c ON c.id = cr.candidate_id
     LEFT JOIN races r ON r.id = c.race_id
     WHERE cr.status = ?
     ORDER BY cr.created_at ASC
     LIMIT ? OFFSET ?`
  ).bind(status, limit, offset).all();

  return successResponse({ corrections: result.results || [], page: Math.floor(offset / limit) + 1, limit });
});

// POST /api/corrections — Submit a correction/appeal request
router.post('/', async (request, env, ctx) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const body = await parseBody(request);
  const { valid, errors, data } = validate(createCorrectionRequestSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  const targetExists = await contentTargetExists(env.ARENA_DB, data.content_type, data.content_id);
  if (!targetExists) return errorResponse('Correction target not found', 404);

  if (data.candidate_id) {
    const candidate = await env.ARENA_DB.prepare(
      `SELECT id FROM candidates WHERE id = ? AND is_active = 1`
    ).bind(data.candidate_id).first();
    if (!candidate) return errorResponse('Candidate not found', 404);
  }

  const correctionId = generateId('corr');
  await env.ARENA_DB.batch([
    env.ARENA_DB.prepare(
      `INSERT INTO correction_requests
       (id, requester_id, content_type, content_id, candidate_id, reason, requested_change, evidence_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      correctionId,
      request.user.id,
      data.content_type,
      data.content_id,
      data.candidate_id || null,
      data.reason,
      data.requested_change,
      data.evidence_url || null,
    ),
    env.ARENA_DB.prepare(
      `INSERT INTO correction_request_events
       (id, correction_request_id, actor_id, event_type, after_status, note, metadata)
       VALUES (?, ?, ?, 'submitted', 'open', ?, ?)`
    ).bind(
      generateId('crev'),
      correctionId,
      request.user.id,
      data.requested_change,
      JSON.stringify({ content_type: data.content_type, content_id: data.content_id, reason: data.reason }),
    ),
  ]);

  await auditLogNow(env.ARENA_DB, {
    actorId: request.user.id,
    action: 'correction.submit',
    entityType: 'correction_request',
    entityId: correctionId,
    afterState: data,
    ipAddress: getClientIP(request),
  });

  return successResponse({ id: correctionId, status: 'open' });
});

// PUT /api/corrections/:id/review — Moderator/admin clears a correction request
router.put('/:id/review', async (request, env, ctx) => {
  const authError = await requireRole('moderator', 'admin', 'super_admin')(request, env);
  if (authError) return authError;

  const body = await parseBody(request);
  const { valid, errors, data } = validate(reviewCorrectionRequestSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  const { id } = request.params;
  const existing = await env.ARENA_DB.prepare(
    `SELECT * FROM correction_requests WHERE id = ?`
  ).bind(id).first();
  if (!existing) return errorResponse('Correction request not found', 404);

  const publicNote = data.public_note || data.resolution_note;
  await env.ARENA_DB.batch([
    env.ARENA_DB.prepare(
      `UPDATE correction_requests
       SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'),
           resolution_note = ?, public_note = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).bind(data.status, request.user.id, data.resolution_note, publicNote, id),
    env.ARENA_DB.prepare(
      `INSERT INTO correction_request_events
       (id, correction_request_id, actor_id, event_type, before_status, after_status, note, public_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      generateId('crev'),
      id,
      request.user.id,
      publicNote ? 'public_note' : 'status_changed',
      existing.status,
      data.status,
      data.resolution_note,
      publicNote,
    ),
  ]);

  await auditLogNow(env.ARENA_DB, {
    actorId: request.user.id,
    action: 'correction.review',
    entityType: 'correction_request',
    entityId: id,
    beforeState: { status: existing.status, public_note: existing.public_note },
    afterState: { status: data.status, public_note: publicNote },
    ipAddress: getClientIP(request),
  });

  return successResponse({ id, status: data.status, public_note: publicNote });
});

export default router;
