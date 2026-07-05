/**
 * Arena — Correction and Appeal Routes
 * Candidate-accessible, append-only dispute records for public accountability items.
 */

import { Router } from 'itty-router';
import { generateId } from '../db.js';
import { auditLog } from '../audit.js';
import { requireAuth, requireRole, errorResponse, successResponse, parseBody, parsePagination, getClientIP } from '../middleware.js';
import { validate, createCorrectionRequestSchema, reviewCorrectionRequestSchema } from '../validation.js';

const router = Router({ base: '/api/corrections' });

async function userCanActForCandidate(db, user, candidateId) {
  if (['admin', 'super_admin', 'moderator'].includes(user.role)) return true;
  if (!candidateId) return false;
  const link = await db.prepare(
    `SELECT id FROM candidate_staff_links
     WHERE user_id = ? AND candidate_id = ? AND is_active = 1`
  ).bind(user.id, candidateId).first();
  return !!link;
}

async function resolveTarget(db, contentType, contentId, user) {
  if (contentType === 'statement') {
    const row = await db.prepare(
      `SELECT ps.id, ps.candidate_id, c.name as candidate_name
       FROM public_statements ps
       JOIN candidates c ON c.id = ps.candidate_id
       WHERE ps.id = ? AND ps.is_public = 1`
    ).bind(contentId).first();
    if (!row) return null;
    return { candidateId: row.candidate_id, label: row.candidate_name };
  }

  if (contentType === 'candidate_profile') {
    const row = await db.prepare(
      `SELECT id, name FROM candidates WHERE id = ? AND is_active = 1`
    ).bind(contentId).first();
    if (!row) return null;
    return { candidateId: row.id, label: row.name };
  }

  if (contentType === 'challenge') {
    const row = await db.prepare(
      `SELECT ch.id, ch.challenger_candidate_id, ch.target_candidate_id,
              challenger.name as challenger_name, target.name as target_name
       FROM challenges ch
       JOIN candidates challenger ON challenger.id = ch.challenger_candidate_id
       JOIN candidates target ON target.id = ch.target_candidate_id
       WHERE ch.id = ? AND ch.is_visible = 1`
    ).bind(contentId).first();
    if (!row) return null;
    const targetIds = [row.challenger_candidate_id, row.target_candidate_id].filter(Boolean);
    for (const candidateId of targetIds) {
      if (await userCanActForCandidate(db, user, candidateId)) {
        return { candidateId, label: `${row.challenger_name} / ${row.target_name}` };
      }
    }
    return { candidateId: row.target_candidate_id, label: `${row.challenger_name} / ${row.target_name}`, unauthorized: true };
  }

  if (contentType === 'recite') {
    const row = await db.prepare(
      `SELECT r.id, r.content_type, r.content_id, r.title
       FROM recites r
       WHERE r.id = ?`
    ).bind(contentId).first();
    if (!row) return null;
    if (row.content_type === 'challenge') {
      const challengeTarget = await resolveTarget(db, 'challenge', row.content_id, user);
      return challengeTarget ? { ...challengeTarget, label: row.title } : null;
    }
    return { candidateId: null, label: row.title, unauthorized: !['admin', 'super_admin', 'moderator'].includes(user.role) };
  }

  return null;
}

function publicCorrectionSelect(whereClause) {
  return `SELECT cr.id, cr.content_type, cr.content_id, cr.candidate_id,
                 cr.request_text, cr.requested_change, cr.evidence_url,
                 cr.status, cr.public_note, cr.created_at, cr.reviewed_at,
                 submitter.display_name as submitted_by_name,
                 reviewer.display_name as reviewed_by_name,
                 c.name as candidate_name
          FROM correction_requests cr
          JOIN users submitter ON submitter.id = cr.submitted_by
          LEFT JOIN users reviewer ON reviewer.id = cr.reviewed_by
          LEFT JOIN candidates c ON c.id = cr.candidate_id
          ${whereClause}`;
}

async function correctionEvents(db, requestId) {
  const result = await db.prepare(
    `SELECT cre.id, cre.action_type, cre.note, cre.previous_status, cre.new_status,
            cre.created_at, u.display_name as actor_name
     FROM correction_request_events cre
     JOIN users u ON u.id = cre.actor_id
     WHERE cre.correction_request_id = ?
     ORDER BY cre.created_at ASC`
  ).bind(requestId).all();
  return result.results || [];
}

// GET /api/corrections?content_type=statement&content_id=... — Public correction history for a record
router.get('/', async (request, env) => {
  const url = new URL(request.url);
  const contentType = url.searchParams.get('content_type');
  const contentId = url.searchParams.get('content_id');
  if (!contentType || !contentId) return errorResponse('content_type and content_id required');
  if (!['statement', 'challenge', 'recite', 'candidate_profile'].includes(contentType)) return errorResponse('Invalid content_type', 400);

  const result = await env.ARENA_DB.prepare(
    `${publicCorrectionSelect(`WHERE cr.content_type = ? AND cr.content_id = ? AND cr.status != 'withdrawn'`)}
     ORDER BY cr.created_at DESC`
  ).bind(contentType, contentId).all();

  const corrections = [];
  for (const item of result.results || []) {
    corrections.push({ ...item, events: await correctionEvents(env.ARENA_DB, item.id) });
  }

  return successResponse({ corrections });
});

// GET /api/corrections/pending — Moderator/admin queue
router.get('/pending', async (request, env) => {
  const authError = await requireRole('moderator', 'admin', 'super_admin')(request, env);
  if (authError) return authError;

  const url = new URL(request.url);
  const { limit, offset } = parsePagination(url);
  const status = url.searchParams.get('status') || 'submitted';
  if (!['submitted', 'under_review', 'upheld', 'revised', 'rejected'].includes(status)) {
    return errorResponse('Invalid status', 400);
  }

  const result = await env.ARENA_DB.prepare(
    `${publicCorrectionSelect(`WHERE cr.status = ?`)}
     ORDER BY cr.created_at ASC
     LIMIT ? OFFSET ?`
  ).bind(status, limit, offset).all();

  return successResponse({ corrections: result.results || [], page: Math.floor(offset / limit) + 1, limit });
});

// POST /api/corrections — Candidate/staff submits a correction or appeal
router.post('/', async (request, env, ctx) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const body = await parseBody(request);
  const { valid, errors, data } = validate(createCorrectionRequestSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  const target = await resolveTarget(env.ARENA_DB, data.content_type, data.content_id, request.user);
  if (!target) return errorResponse('Correction target not found', 404);
  if (target.unauthorized || !(await userCanActForCandidate(env.ARENA_DB, request.user, target.candidateId))) {
    return errorResponse('Only candidate staff or moderators can file a correction for this record', 403);
  }

  const requestId = generateId('corr');
  const eventId = generateId('correvt');
  await env.ARENA_DB.batch([
    env.ARENA_DB.prepare(
      `INSERT INTO correction_requests
       (id, content_type, content_id, submitted_by, candidate_id, request_text, requested_change, evidence_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      requestId,
      data.content_type,
      data.content_id,
      request.user.id,
      target.candidateId,
      data.request_text,
      data.requested_change || null,
      data.evidence_url || null,
    ),
    env.ARENA_DB.prepare(
      `INSERT INTO correction_request_events
       (id, correction_request_id, actor_id, action_type, note, new_status)
       VALUES (?, ?, ?, 'submitted', ?, 'submitted')`
    ).bind(eventId, requestId, request.user.id, data.request_text),
  ]);

  if (data.content_type === 'statement') {
    await env.ARENA_DB.prepare(
      `UPDATE public_statements
       SET review_status = CASE WHEN reviewed_at IS NULL THEN review_status ELSE 'disputed' END,
           updated_at = datetime('now')
       WHERE id = ?`
    ).bind(data.content_id).run();
  }

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: 'correction.submit',
    entityType: 'correction_request',
    entityId: requestId,
    afterState: { content_type: data.content_type, content_id: data.content_id, candidate_id: target.candidateId },
    ipAddress: getClientIP(request),
  });

  return successResponse({
    id: requestId,
    status: 'submitted',
    content_type: data.content_type,
    content_id: data.content_id,
    candidate_id: target.candidateId,
  });
});

// PUT /api/corrections/:id/review — Moderator/admin resolves or updates a correction request
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

  const eventId = generateId('correvt');
  const actionType = data.status === 'under_review' ? 'status_changed' : data.status;
  await env.ARENA_DB.batch([
    env.ARENA_DB.prepare(
      `UPDATE correction_requests
       SET status = ?,
           public_note = ?,
           reviewed_by = ?,
           reviewed_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ?`
    ).bind(data.status, data.public_note, request.user.id, id),
    env.ARENA_DB.prepare(
      `INSERT INTO correction_request_events
       (id, correction_request_id, actor_id, action_type, note, previous_status, new_status, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      eventId,
      id,
      request.user.id,
      actionType,
      data.public_note,
      existing.status,
      data.status,
      data.internal_note ? JSON.stringify({ internal_note: data.internal_note }) : null,
    ),
  ]);

  if (existing.content_type === 'statement' && ['upheld', 'revised', 'rejected'].includes(data.status)) {
    await env.ARENA_DB.prepare(
      `UPDATE public_statements
       SET review_status = CASE
             WHEN ? = 'revised' THEN 'revised'
             WHEN ? = 'upheld' THEN 'upheld'
             ELSE review_status
           END,
           updated_at = datetime('now')
       WHERE id = ?`
    ).bind(data.status, data.status, existing.content_id).run();
  }

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: `correction.${data.status}`,
    entityType: 'correction_request',
    entityId: id,
    beforeState: { status: existing.status },
    afterState: { status: data.status, public_note: data.public_note },
    ipAddress: getClientIP(request),
  });

  return successResponse({ id, status: data.status, public_note: data.public_note });
});

export default router;
