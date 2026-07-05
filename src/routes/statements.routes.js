/**
 * Arena — Public Statement Routes
 * Timestamped statement ledger with transcript/source metadata and review fields.
 */

import { Router } from 'itty-router';
import { generateId } from '../db.js';
import { auditLog } from '../audit.js';
import { requireAuth, requireRole, errorResponse, successResponse, parseBody, parsePagination, getClientIP } from '../middleware.js';
import { validate, createStatementSchema, reviewStatementSchema, secondReviewStatementSchema } from '../validation.js';

const router = Router({ base: '/api/statements' });
const REVIEW_RUBRIC_VERSION = '2026-07-05';
const REVIEW_RUBRIC = {
  version: REVIEW_RUBRIC_VERSION,
  principle: 'Procedural record first; editorial judgment second. Scores describe documented responsiveness and source support, not absolute truth.',
  reviewer_requirements: [
    'Every scored public statement requires a named first reviewer and a named second reviewer.',
    'The second reviewer must be a different moderator, admin, or super admin.',
    'Disputed reviews remain publicly marked and must retain correction history.',
  ],
  truth_status: {
    unreviewed: 'No editorial review has been published.',
    supported: 'The available verified sources materially support the statement.',
    disputed: 'Verified sources materially dispute part or all of the statement.',
    false: 'Verified sources directly contradict the core factual claim.',
    mixed: 'Verified sources support some parts and dispute others.',
    context_needed: 'The claim cannot be evaluated fairly without more context.',
  },
  answer_status: {
    answered: 'The response directly addresses the question or claim.',
    partial: 'The response addresses part of the question or claim.',
    dodged: 'The response avoids the central question or claim.',
    not_applicable: 'No answer judgment applies to this record.',
    unclear: 'The response cannot be categorized confidently.',
  },
  evasion_score: {
    0: 'No evasion identified or not applicable.',
    25: 'Minor incompleteness or ambiguity.',
    50: 'Materially partial answer.',
    75: 'Substantial avoidance of the central issue.',
    100: 'Complete avoidance after clear notice.',
  },
};

function claimKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !['the', 'and', 'for', 'that', 'this', 'with', 'from', 'you', 'are'].includes(word))
    .slice(0, 12)
    .join(' ');
}

async function canActForCandidate(request, env, candidateId) {
  const link = await env.ARENA_DB.prepare(
    `SELECT id FROM candidate_staff_links WHERE user_id = ? AND candidate_id = ? AND is_active = 1`
  ).bind(request.user.id, candidateId).first();
  return !!link;
}

async function publicCorrectionNotes(db, contentType, contentId) {
  const result = await db.prepare(
    `SELECT cr.id, cr.status, cr.request_text, cr.requested_change, cr.evidence_url,
            cr.public_note, cr.created_at, cr.reviewed_at, u.display_name as submitted_by_name,
            reviewer.display_name as reviewed_by_name
     FROM correction_requests cr
     JOIN users u ON u.id = cr.submitted_by
     LEFT JOIN users reviewer ON reviewer.id = cr.reviewed_by
     WHERE cr.content_type = ? AND cr.content_id = ? AND cr.status != 'withdrawn'
     ORDER BY cr.created_at DESC`
  ).bind(contentType, contentId).all();
  return result.results || [];
}

async function reviewHistory(db, statementId) {
  const result = await db.prepare(
    `SELECT srv.id, srv.version_number, srv.truth_status, srv.answer_status,
            srv.evasion_score, srv.confidence_score, srv.review_note,
            srv.second_review_note, srv.rubric_version, srv.status,
            srv.created_at, srv.second_reviewed_at, srv.published_at,
            reviewer.display_name as reviewer_name,
            second_reviewer.display_name as second_reviewer_name
     FROM statement_review_versions srv
     JOIN users reviewer ON reviewer.id = srv.reviewer_id
     LEFT JOIN users second_reviewer ON second_reviewer.id = srv.second_reviewer_id
     WHERE srv.statement_id = ?
     ORDER BY srv.version_number DESC`
  ).bind(statementId).all();
  return result.results || [];
}

function statementReviewSelect(whereClause) {
  return `SELECT ps.*, c.name as candidate_name, r.name as race_name,
                 reviewer.display_name as reviewer_name,
                 second_reviewer.display_name as second_reviewer_name
          FROM public_statements ps
          JOIN candidates c ON ps.candidate_id = c.id
          LEFT JOIN races r ON ps.race_id = r.id
          LEFT JOIN users reviewer ON reviewer.id = ps.reviewed_by
          LEFT JOIN users second_reviewer ON second_reviewer.id = ps.second_reviewed_by
          ${whereClause}`;
}

// GET /api/statements/candidates/:candidateId — Public candidate statement ledger
router.get('/candidates/:candidateId', async (request, env) => {
  const { candidateId } = request.params;
  const url = new URL(request.url);
  const { limit, offset } = parsePagination(url);
  const topic = url.searchParams.get('topic');

  let sql = statementReviewSelect(`WHERE ps.candidate_id = ? AND ps.is_public = 1`);
  const binds = [candidateId];
  if (topic) {
    sql += ` AND lower(ps.topic) = lower(?)`;
    binds.push(topic);
  }
  sql += ` ORDER BY COALESCE(ps.statement_at, ps.created_at) DESC LIMIT ? OFFSET ?`;
  binds.push(limit, offset);

  const result = await env.ARENA_DB.prepare(sql).bind(...binds).all();
  return successResponse({ statements: result.results || [] });
});

// GET /api/statements/search?q=... — Public claim/phrase search
router.get('/search', async (request, env) => {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  if (q.length < 3) return errorResponse('Search query must be at least 3 characters', 400);
  const { limit, offset } = parsePagination(url);
  const key = claimKey(q);
  const like = `%${q.toLowerCase()}%`;

  const result = await env.ARENA_DB.prepare(
    `${statementReviewSelect(`WHERE ps.is_public = 1`)}
       AND (lower(ps.statement_text) LIKE ? OR lower(ps.context_text) LIKE ? OR ps.claim_key = ?)
     ORDER BY COALESCE(ps.statement_at, ps.created_at) DESC
     LIMIT ? OFFSET ?`
  ).bind(like, like, key, limit, offset).all();

  return successResponse({ statements: result.results || [], claim_key: key });
});

// GET /api/statements/review-rubric — Public reviewer rubric
router.get('/review-rubric', async () => {
  return successResponse({ rubric: REVIEW_RUBRIC });
});

// GET /api/statements/reviews/pending — Moderator/admin second-review queue
router.get('/reviews/pending', async (request, env) => {
  const authError = await requireRole('moderator', 'admin', 'super_admin')(request, env);
  if (authError) return authError;

  const url = new URL(request.url);
  const { limit, offset } = parsePagination(url);
  const result = await env.ARENA_DB.prepare(
    `SELECT srv.*, ps.statement_text, ps.source_url, c.name as candidate_name, r.name as race_name,
            reviewer.display_name as reviewer_name
     FROM statement_review_versions srv
     JOIN public_statements ps ON ps.id = srv.statement_id
     JOIN candidates c ON c.id = ps.candidate_id
     LEFT JOIN races r ON r.id = ps.race_id
     JOIN users reviewer ON reviewer.id = srv.reviewer_id
     WHERE srv.status = 'pending_second_review'
     ORDER BY srv.created_at ASC
     LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();

  return successResponse({ reviews: result.results || [], page: Math.floor(offset / limit) + 1, limit });
});

// GET /api/statements/:id — Public single statement
router.get('/:id', async (request, env) => {
  const { id } = request.params;
  const statement = await env.ARENA_DB.prepare(
    `${statementReviewSelect(`WHERE ps.id = ? AND ps.is_public = 1`)}`
  ).bind(id).first();
  if (!statement) return errorResponse('Statement not found', 404);
  const [reviews, corrections] = await Promise.all([
    reviewHistory(env.ARENA_DB, id),
    publicCorrectionNotes(env.ARENA_DB, 'statement', id),
  ]);
  return successResponse({ statement, review_history: reviews, corrections, rubric: REVIEW_RUBRIC });
});

// POST /api/statements — Candidate staff logs a timestamped statement
router.post('/', async (request, env, ctx) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const body = await parseBody(request);
  const { valid, errors, data } = validate(createStatementSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  const candidate = await env.ARENA_DB.prepare(
    `SELECT id, race_id FROM candidates WHERE id = ? AND is_active = 1`
  ).bind(data.candidate_id).first();
  if (!candidate) return errorResponse('Candidate not found', 404);

  if (!(await canActForCandidate(request, env, data.candidate_id))) {
    return errorResponse('Not authorized for this candidate', 403);
  }

  const statementId = generateId('stmt');
  const key = claimKey(data.statement_text);
  await env.ARENA_DB.prepare(
    `INSERT INTO public_statements
     (id, candidate_id, race_id, created_by, statement_text, question_text, response_text, context_text, topic,
      claim_key, source_type, source_url, source_title, transcript_url, transcript_text,
      quote_start_seconds, quote_end_seconds, statement_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    statementId,
    data.candidate_id,
    data.race_id || candidate.race_id || null,
    request.user.id,
    data.statement_text,
    data.question_text || null,
    data.response_text || null,
    data.context_text || null,
    data.topic || null,
    key,
    data.source_type,
    data.source_url,
    data.source_title || null,
    data.transcript_url || null,
    data.transcript_text || null,
    data.quote_start_seconds ?? null,
    data.quote_end_seconds ?? null,
    data.statement_at || null,
  ).run();

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: 'statement.create',
    entityType: 'statement',
    entityId: statementId,
    afterState: { candidate_id: data.candidate_id, claim_key: key },
    ipAddress: getClientIP(request),
  });

  return successResponse({ id: statementId, claim_key: key });
});

// PUT /api/statements/:id/review — Moderator/admin proposes a scored review.
// It is not published until a different reviewer approves it.
router.put('/:id/review', async (request, env, ctx) => {
  const authError = await requireRole('moderator', 'admin', 'super_admin')(request, env);
  if (authError) return authError;

  const body = await parseBody(request);
  const { valid, errors, data } = validate(reviewStatementSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  const { id } = request.params;
  const existing = await env.ARENA_DB.prepare(`SELECT * FROM public_statements WHERE id = ?`).bind(id).first();
  if (!existing) return errorResponse('Statement not found', 404);

  const pending = await env.ARENA_DB.prepare(
    `SELECT id FROM statement_review_versions
     WHERE statement_id = ? AND status = 'pending_second_review'
     LIMIT 1`
  ).bind(id).first();
  if (pending) return errorResponse('Statement already has a pending second review', 409);

  const versionRow = await env.ARENA_DB.prepare(
    `SELECT COALESCE(MAX(version_number), 0) + 1 as next_version
     FROM statement_review_versions WHERE statement_id = ?`
  ).bind(id).first();
  const reviewVersionId = generateId('stmtrev');
  const values = {
    truth_status: data.truth_status ?? existing.truth_status,
    answer_status: data.answer_status ?? existing.answer_status,
    evasion_score: data.evasion_score ?? existing.evasion_score,
    confidence_score: data.confidence_score ?? existing.confidence_score,
    review_note: data.review_note ?? null,
    rubric_version: data.rubric_version || REVIEW_RUBRIC_VERSION,
  };

  await env.ARENA_DB.batch([
    env.ARENA_DB.prepare(
      `INSERT INTO statement_review_versions
       (id, statement_id, reviewer_id, version_number, truth_status, answer_status,
        evasion_score, confidence_score, review_note, rubric_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      reviewVersionId,
      id,
      request.user.id,
      versionRow.next_version,
      values.truth_status,
      values.answer_status,
      values.evasion_score,
      values.confidence_score,
      values.review_note,
      values.rubric_version,
    ),
    env.ARENA_DB.prepare(
      `UPDATE public_statements
       SET review_status = 'pending_second_review',
           latest_review_version_id = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).bind(reviewVersionId, id),
  ]);

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: 'statement.review.propose',
    entityType: 'statement',
    entityId: id,
    beforeState: { truth_status: existing.truth_status, answer_status: existing.answer_status, evasion_score: existing.evasion_score },
    afterState: { ...values, review_version_id: reviewVersionId, status: 'pending_second_review' },
  });

  return successResponse({
    id,
    review_version_id: reviewVersionId,
    review_status: 'pending_second_review',
    requires_second_review: true,
    ...values,
  });
});

// PUT /api/statements/:id/review/:versionId/second-review — independent reviewer publishes or rejects
router.put('/:id/review/:versionId/second-review', async (request, env, ctx) => {
  const authError = await requireRole('moderator', 'admin', 'super_admin')(request, env);
  if (authError) return authError;

  const body = await parseBody(request);
  const { valid, errors, data } = validate(secondReviewStatementSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  const { id, versionId } = request.params;
  const review = await env.ARENA_DB.prepare(
    `SELECT srv.*, ps.review_status, ps.latest_review_version_id
     FROM statement_review_versions srv
     JOIN public_statements ps ON ps.id = srv.statement_id
     WHERE srv.id = ? AND srv.statement_id = ?`
  ).bind(versionId, id).first();
  if (!review) return errorResponse('Statement review not found', 404);
  if (review.status !== 'pending_second_review') return errorResponse('Statement review is not pending second review', 409);
  if (review.reviewer_id === request.user.id) return errorResponse('Second reviewer must be different from first reviewer', 400);

  if (data.decision === 'reject') {
    const previousPublished = await env.ARENA_DB.prepare(
      `SELECT id FROM statement_review_versions
       WHERE statement_id = ? AND status = 'published'
       ORDER BY version_number DESC LIMIT 1`
    ).bind(id).first();
    const nextStatus = previousPublished ? 'published' : 'unreviewed';
    await env.ARENA_DB.batch([
      env.ARENA_DB.prepare(
        `UPDATE statement_review_versions
         SET status = 'rejected',
             second_reviewer_id = ?,
             second_review_note = ?,
             second_reviewed_at = datetime('now')
         WHERE id = ?`
      ).bind(request.user.id, data.review_note || null, versionId),
      env.ARENA_DB.prepare(
        `UPDATE public_statements
         SET review_status = ?,
             latest_review_version_id = ?,
             updated_at = datetime('now')
         WHERE id = ?`
      ).bind(nextStatus, previousPublished?.id || null, id),
    ]);

    auditLog(env.ARENA_DB, ctx, {
      actorId: request.user.id,
      action: 'statement.review.reject',
      entityType: 'statement',
      entityId: id,
      beforeState: { review_version_id: versionId, status: review.status },
      afterState: { review_version_id: versionId, status: 'rejected', review_note: data.review_note || null },
    });
    return successResponse({ id, review_version_id: versionId, review_status: nextStatus, decision: 'reject' });
  }

  await env.ARENA_DB.batch([
    env.ARENA_DB.prepare(
      `UPDATE statement_review_versions
       SET status = 'superseded'
       WHERE statement_id = ? AND status = 'published'`
    ).bind(id),
    env.ARENA_DB.prepare(
      `UPDATE statement_review_versions
       SET status = 'published',
           second_reviewer_id = ?,
           second_review_note = ?,
           second_reviewed_at = datetime('now'),
           published_at = datetime('now')
       WHERE id = ?`
    ).bind(request.user.id, data.review_note || null, versionId),
    env.ARENA_DB.prepare(
      `UPDATE public_statements
       SET truth_status = ?,
           answer_status = ?,
           evasion_score = ?,
           confidence_score = ?,
           review_status = 'published',
           review_note = ?,
           reviewed_by = ?,
           reviewed_at = datetime('now'),
           second_reviewed_by = ?,
           second_reviewed_at = datetime('now'),
           review_rubric_version = ?,
           latest_review_version_id = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).bind(
      review.truth_status,
      review.answer_status,
      review.evasion_score,
      review.confidence_score,
      review.review_note || null,
      review.reviewer_id,
      request.user.id,
      review.rubric_version,
      versionId,
      id,
    ),
  ]);

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: 'statement.review.publish',
    entityType: 'statement',
    entityId: id,
    beforeState: { truth_status: review.truth_status, answer_status: review.answer_status, evasion_score: review.evasion_score, status: review.status },
    afterState: { review_version_id: versionId, status: 'published', second_review_note: data.review_note || null },
  });

  return successResponse({
    id,
    review_version_id: versionId,
    review_status: 'published',
    truth_status: review.truth_status,
    answer_status: review.answer_status,
    evasion_score: review.evasion_score,
    confidence_score: review.confidence_score,
  });
});

export default router;
