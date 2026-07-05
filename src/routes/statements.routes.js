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
  if (['admin', 'super_admin'].includes(request.user.role)) return true;
  const link = await env.ARENA_DB.prepare(
    `SELECT id FROM candidate_staff_links WHERE user_id = ? AND candidate_id = ? AND is_active = 1`
  ).bind(request.user.id, candidateId).first();
  return !!link;
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

// POST /api/statements — Candidate staff/admin logs a timestamped statement
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
    beforeState: { truth_status: existing.truth_status, answer_status: existing.answer_status, evasion_score: existing.evasion_score },
    afterState: data,
  });

  return successResponse({ id, ...data });
});

export default router;
