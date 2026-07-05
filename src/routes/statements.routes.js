/**
 * Arena — Public Statement Routes
 * Timestamped statement ledger with transcript/source metadata and review fields.
 */

import { Router } from 'itty-router';
import { generateId } from '../db.js';
import { auditLog } from '../audit.js';
import { requireAuth, requireRole, errorResponse, successResponse, parseBody, parsePagination, getClientIP } from '../middleware.js';
import { validate, createStatementSchema, reviewStatementSchema } from '../validation.js';

const router = Router({ base: '/api/statements' });

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

function finalReviewFrom(existing, data) {
  return {
    truth_status: data.truth_status ?? existing.truth_status,
    answer_status: data.answer_status ?? existing.answer_status,
    evasion_score: data.evasion_score ?? existing.evasion_score,
    confidence_score: data.confidence_score ?? existing.confidence_score,
  };
}

function isHighStakesReview(review) {
  return review.truth_status !== 'unreviewed'
    || !['answered', 'not_applicable'].includes(review.answer_status)
    || review.evasion_score > 0;
}

async function findMatchingPendingReview(db, statementId, reviewerId, review) {
  return db.prepare(
    `SELECT srp.*, u.display_name as reviewer_name
     FROM statement_review_proposals srp
     JOIN users u ON u.id = srp.reviewer_id
     WHERE srp.statement_id = ?
       AND srp.status = 'pending'
       AND srp.reviewer_id != ?
       AND srp.truth_status = ?
       AND srp.answer_status = ?
       AND srp.evasion_score = ?
       AND srp.confidence_score = ?
     ORDER BY srp.created_at ASC
     LIMIT 1`
  ).bind(
    statementId,
    reviewerId,
    review.truth_status,
    review.answer_status,
    review.evasion_score,
    review.confidence_score,
  ).first();
}

async function userHasPendingStatementReview(db, statementId, reviewerId) {
  return !!(await db.prepare(
    `SELECT id FROM statement_review_proposals
     WHERE statement_id = ? AND reviewer_id = ? AND status = 'pending'
     LIMIT 1`
  ).bind(statementId, reviewerId).first());
}

// GET /api/statements/candidates/:candidateId — Public candidate statement ledger
router.get('/candidates/:candidateId', async (request, env) => {
  const { candidateId } = request.params;
  const url = new URL(request.url);
  const { limit, offset } = parsePagination(url);
  const topic = url.searchParams.get('topic');

  let sql = `
    SELECT ps.*, c.name as candidate_name, r.name as race_name
    FROM public_statements ps
    JOIN candidates c ON ps.candidate_id = c.id
    LEFT JOIN races r ON ps.race_id = r.id
    WHERE ps.candidate_id = ? AND ps.is_public = 1
  `;
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
    `SELECT ps.*, c.name as candidate_name, r.name as race_name
     FROM public_statements ps
     JOIN candidates c ON ps.candidate_id = c.id
     LEFT JOIN races r ON ps.race_id = r.id
     WHERE ps.is_public = 1
       AND (lower(ps.statement_text) LIKE ? OR lower(ps.context_text) LIKE ? OR ps.claim_key = ?)
     ORDER BY COALESCE(ps.statement_at, ps.created_at) DESC
     LIMIT ? OFFSET ?`
  ).bind(like, like, key, limit, offset).all();

  return successResponse({ statements: result.results || [], claim_key: key });
});

// GET /api/statements/review-pending — Moderator/admin second-review queue
router.get('/review-pending', async (request, env) => {
  const authError = await requireRole('moderator', 'admin', 'super_admin')(request, env);
  if (authError) return authError;

  const url = new URL(request.url);
  const { limit, offset } = parsePagination(url);
  const result = await env.ARENA_DB.prepare(
    `SELECT srp.*, ps.statement_text, ps.source_url, ps.source_title,
            c.name as candidate_name, r.name as race_name,
            u.display_name as reviewer_name
     FROM statement_review_proposals srp
     JOIN public_statements ps ON ps.id = srp.statement_id
     JOIN candidates c ON c.id = ps.candidate_id
     LEFT JOIN races r ON r.id = ps.race_id
     JOIN users u ON u.id = srp.reviewer_id
     WHERE srp.status = 'pending'
     ORDER BY srp.created_at ASC
     LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();

  return successResponse({ proposals: result.results || [], page: Math.floor(offset / limit) + 1, limit });
});

// GET /api/statements/review-rubric — Public moderation rubric for statement/evasion reviews
router.get('/review-rubric', () => successResponse({
  rubric: {
    principle: 'Statement reviews are source-labeled moderation calls, not platform claims of absolute truth.',
    truth_statuses: {
      unreviewed: 'No moderator truth review has been applied.',
      supported: 'Available cited sources materially support the statement.',
      disputed: 'Available cited sources materially dispute the statement.',
      false: 'Available cited sources show the statement is materially false.',
      mixed: 'Available cited sources support part of the statement and dispute part of it.',
      context_needed: 'The statement cannot be fairly scored without additional context.',
    },
    answer_statuses: {
      answered: 'The response directly addresses the question or claim.',
      partial: 'The response addresses part of the question or claim.',
      dodged: 'The response avoids the central question or claim.',
      unclear: 'The response is too ambiguous to classify cleanly.',
      not_applicable: 'No answer-status review applies to this statement.',
    },
    evasion_score: {
      0: 'No evasion score applied.',
      '1-39': 'Minor incompleteness or ambiguity.',
      '40-69': 'Materially partial, unclear, or indirect answer.',
      '70-100': 'Substantial dodge or off-topic response.',
    },
    safeguards: {
      high_stakes_reviews_require_second_reviewer: true,
      high_stakes_definition: 'Any non-unreviewed truth label, partial/dodged/unclear answer label, or evasion score above 0.',
      correction_path: '/api/corrections',
    },
  },
}));

// GET /api/statements/:id — Public single statement
router.get('/:id', async (request, env) => {
  const { id } = request.params;
  const statement = await env.ARENA_DB.prepare(
    `SELECT ps.*, c.name as candidate_name, r.name as race_name
     FROM public_statements ps
     JOIN candidates c ON ps.candidate_id = c.id
     LEFT JOIN races r ON ps.race_id = r.id
     WHERE ps.id = ? AND ps.is_public = 1`
  ).bind(id).first();
  if (!statement) return errorResponse('Statement not found', 404);
  return successResponse({ statement });
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

// PUT /api/statements/:id/review — Moderator/admin reviews truth/evasion status
router.put('/:id/review', async (request, env, ctx) => {
  const authError = await requireRole('moderator', 'admin', 'super_admin')(request, env);
  if (authError) return authError;

  const body = await parseBody(request);
  const { valid, errors, data } = validate(reviewStatementSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  const { id } = request.params;
  const existing = await env.ARENA_DB.prepare(`SELECT * FROM public_statements WHERE id = ?`).bind(id).first();
  if (!existing) return errorResponse('Statement not found', 404);

  const finalReview = finalReviewFrom(existing, data);
  if (isHighStakesReview(finalReview)) {
    const matchingPending = await findMatchingPendingReview(env.ARENA_DB, id, request.user.id, finalReview);
    if (!matchingPending) {
      const alreadyProposed = await userHasPendingStatementReview(env.ARENA_DB, id, request.user.id);
      if (alreadyProposed) return errorResponse('A different moderator must confirm this pending statement review', 409);

      const proposalId = generateId('srp');
      await env.ARENA_DB.prepare(
        `INSERT INTO statement_review_proposals
         (id, statement_id, reviewer_id, truth_status, answer_status, evasion_score, confidence_score, review_note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        proposalId,
        id,
        request.user.id,
        finalReview.truth_status,
        finalReview.answer_status,
        finalReview.evasion_score,
        finalReview.confidence_score,
        data.review_note || null,
      ).run();

      auditLog(env.ARENA_DB, ctx, {
        actorId: request.user.id,
        action: 'statement.review_propose',
        entityType: 'statement',
        entityId: id,
        beforeState: {
          truth_status: existing.truth_status,
          answer_status: existing.answer_status,
          evasion_score: existing.evasion_score,
          confidence_score: existing.confidence_score,
        },
        afterState: finalReview,
      });

      return successResponse({
        id,
        review_status: 'pending_second_review',
        requires_second_reviewer: true,
        proposal_id: proposalId,
        proposed: finalReview,
      });
    }

    const reviewNote = data.review_note || matchingPending.review_note || null;
    await env.ARENA_DB.batch([
      env.ARENA_DB.prepare(
        `UPDATE public_statements
         SET truth_status = ?,
             answer_status = ?,
             evasion_score = ?,
             confidence_score = ?,
             review_note = ?,
             reviewed_by = ?,
             reviewed_at = datetime('now'),
             updated_at = datetime('now')
         WHERE id = ?`
      ).bind(
        finalReview.truth_status,
        finalReview.answer_status,
        finalReview.evasion_score,
        finalReview.confidence_score,
        reviewNote,
        request.user.id,
        id,
      ),
      env.ARENA_DB.prepare(
        `UPDATE statement_review_proposals
         SET status = 'applied',
             second_reviewer_id = ?,
             applied_at = datetime('now'),
             updated_at = datetime('now')
         WHERE id = ?`
      ).bind(request.user.id, matchingPending.id),
    ]);

    auditLog(env.ARENA_DB, ctx, {
      actorId: request.user.id,
      action: 'statement.review_apply',
      entityType: 'statement',
      entityId: id,
      beforeState: {
        truth_status: existing.truth_status,
        answer_status: existing.answer_status,
        evasion_score: existing.evasion_score,
        confidence_score: existing.confidence_score,
      },
      afterState: {
        ...finalReview,
        first_reviewer_id: matchingPending.reviewer_id,
        second_reviewer_id: request.user.id,
      },
    });

    return successResponse({
      id,
      ...finalReview,
      review_note: reviewNote,
      review_status: 'applied',
      first_reviewer_id: matchingPending.reviewer_id,
      second_reviewer_id: request.user.id,
    });
  }

  await env.ARENA_DB.prepare(
    `UPDATE public_statements
     SET truth_status = COALESCE(?, truth_status),
         answer_status = COALESCE(?, answer_status),
         evasion_score = COALESCE(?, evasion_score),
         confidence_score = COALESCE(?, confidence_score),
         review_note = COALESCE(?, review_note),
         reviewed_by = ?,
         reviewed_at = datetime('now'),
         updated_at = datetime('now')
     WHERE id = ?`
  ).bind(
    data.truth_status ?? null,
    data.answer_status ?? null,
    data.evasion_score ?? null,
    data.confidence_score ?? null,
    data.review_note ?? null,
    request.user.id,
    id,
  ).run();

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: 'statement.review',
    entityType: 'statement',
    entityId: id,
    beforeState: {
      truth_status: existing.truth_status,
      answer_status: existing.answer_status,
      evasion_score: existing.evasion_score,
      confidence_score: existing.confidence_score,
    },
    afterState: data,
  });

  return successResponse({ id, ...data, review_status: 'applied' });
});

export default router;
