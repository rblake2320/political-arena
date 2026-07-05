/**
 * Arena — Questions Routes
 * Voter + Press questions per race, upvote/downvote, top-5 bubbling
 */

import { Router } from 'itty-router';
import { generateId } from '../db.js';
import {
  requireAuth, requireVerifiedVoter, requireApprovedPress,
  optionalAuth, successResponse, errorResponse, parsePagination, parseBody,
} from '../middleware.js';
import { validate, submitQuestionSchema } from '../validation.js';
import { checkRateLimit } from '../ratelimit.js';

const router = Router({ base: '/api/questions' });
const VOTE_MAX_PER_USER = 20;
const VOTE_WINDOW_SECONDS = 10 * 60;

/**
 * GET /api/questions/:raceId — List questions for a race (public)
 * Query: source_type (voter|press), page, limit
 */
router.get('/:raceId', async (request, env) => {
  await optionalAuth(request, env);
  const { raceId } = request.params;
  const url = new URL(request.url);
  const sourceType = url.searchParams.get('source_type');
  const { page, limit, offset } = parsePagination(url);

  let query = `SELECT q.*, u.display_name as author_name FROM questions q JOIN users u ON q.user_id = u.id WHERE q.race_id = ? AND q.status = 'active'`;
  const binds = [raceId];

  if (sourceType && (sourceType === 'voter' || sourceType === 'press')) {
    query += ` AND q.source_type = ?`;
    binds.push(sourceType);
  }

  query += ` ORDER BY q.vote_count DESC, q.created_at DESC LIMIT ? OFFSET ?`;
  binds.push(limit, offset);

  const questions = await env.ARENA_DB.prepare(query).bind(...binds).all();

  // Count total for pagination
  let countQuery = `SELECT COUNT(*) as total FROM questions WHERE race_id = ? AND status = 'active'`;
  const countBinds = [raceId];
  if (sourceType && (sourceType === 'voter' || sourceType === 'press')) {
    countQuery += ` AND source_type = ?`;
    countBinds.push(sourceType);
  }
  const total = await env.ARENA_DB.prepare(countQuery).bind(...countBinds).first();

  // Mark user's votes if authenticated
  let userVotes = {};
  if (request.user && questions.results.length > 0) {
    const qIds = questions.results.map(q => q.id);
    const placeholders = qIds.map(() => '?').join(',');
    const votes = await env.ARENA_DB.prepare(
      `SELECT question_id FROM question_votes WHERE user_id = ? AND question_id IN (${placeholders})`
    ).bind(request.user.id, ...qIds).all();
    for (const v of votes.results) {
      userVotes[v.question_id] = true;
    }
  }

  // Mark top 5 per source_type
  const enriched = questions.results.map((q, idx) => ({
    ...q,
    has_voted: !!userVotes[q.id],
    is_top: idx < 5 && offset === 0,
  }));

  return successResponse({
    questions: enriched,
    pagination: { page, limit, total: total.total },
  });
});

/**
 * GET /api/questions/:raceId/top — Top 5 voter + top 5 press (public shortcut)
 */
router.get('/:raceId/top', async (request, env) => {
  await optionalAuth(request, env);
  const { raceId } = request.params;

  const [voterQ, pressQ] = await Promise.all([
    env.ARENA_DB.prepare(
      `SELECT q.*, u.display_name as author_name FROM questions q JOIN users u ON q.user_id = u.id WHERE q.race_id = ? AND q.source_type = 'voter' AND q.status = 'active' ORDER BY q.vote_count DESC LIMIT 5`
    ).bind(raceId).all(),
    env.ARENA_DB.prepare(
      `SELECT q.*, u.display_name as author_name FROM questions q JOIN users u ON q.user_id = u.id WHERE q.race_id = ? AND q.source_type = 'press' AND q.status = 'active' ORDER BY q.vote_count DESC LIMIT 5`
    ).bind(raceId).all(),
  ]);

  // Mark user's votes if authenticated
  let userVotes = {};
  if (request.user) {
    const allIds = [...voterQ.results, ...pressQ.results].map(q => q.id);
    if (allIds.length > 0) {
      const placeholders = allIds.map(() => '?').join(',');
      const votes = await env.ARENA_DB.prepare(
        `SELECT question_id FROM question_votes WHERE user_id = ? AND question_id IN (${placeholders})`
      ).bind(request.user.id, ...allIds).all();
      for (const v of votes.results) {
        userVotes[v.question_id] = true;
      }
    }
  }

  const enrich = (arr) => arr.map(q => ({ ...q, has_voted: !!userVotes[q.id], is_top: true }));

  return successResponse({
    voter_questions: enrich(voterQ.results),
    press_questions: enrich(pressQ.results),
  });
});

/**
 * POST /api/questions/:raceId — Submit a question
 * Body: { source_type, question_text, media_url? }
 */
router.post('/:raceId', async (request, env) => {
  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid JSON body');

  const { valid, errors, data } = validate(submitQuestionSchema, body);
  if (!valid) return errorResponse(errors.join(', '));

  // Auth gate based on source_type (super_admin bypasses)
  const authErr = await requireAuth(request, env);
  if (authErr) return authErr;
  const isSuperAdmin = ['admin', 'super_admin'].includes(request.user.role);
  if (!isSuperAdmin) {
    if (data.source_type === 'voter') {
      const err = await requireVerifiedVoter(request, env);
      if (err) return err;
    } else if (data.source_type === 'press') {
      const err = await requireApprovedPress(request, env);
      if (err) return err;
    }
  }

  const { raceId } = request.params;

  // Verify race exists
  const race = await env.ARENA_DB.prepare(`SELECT id FROM races WHERE id = ?`).bind(raceId).first();
  if (!race) return errorResponse('Race not found', 404);

  // Rate limit: max 5 questions per user per race per day
  const recentCount = await env.ARENA_DB.prepare(
    `SELECT COUNT(*) as cnt FROM questions WHERE user_id = ? AND race_id = ? AND created_at > datetime('now', '-1 day')`
  ).bind(request.user.id, raceId).first();
  if (recentCount.cnt >= 5) return errorResponse('You can submit up to 5 questions per race per day', 429);

  const id = generateId('q');
  await env.ARENA_DB.prepare(
    `INSERT INTO questions (id, race_id, user_id, source_type, question_text, media_url) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, raceId, request.user.id, data.source_type, data.question_text, data.media_url || null).run();

  return successResponse({ id, source_type: data.source_type, question_text: data.question_text });
});

/**
 * POST /api/questions/:questionId/vote — Toggle upvote
 */
router.post('/:questionId/vote', async (request, env) => {
  const { questionId } = request.params;

  // Fetch question to determine source_type
  const question = await env.ARENA_DB.prepare(
    `SELECT id, source_type, vote_count FROM questions WHERE id = ? AND status = 'active'`
  ).bind(questionId).first();
  if (!question) return errorResponse('Question not found', 404);

  // Auth gate based on source_type (super_admin bypasses)
  const authErr2 = await requireAuth(request, env);
  if (authErr2) return authErr2;

  const voteLimit = await checkRateLimit(
    env.ARENA_DB,
    `question-vote:${request.user.id}`,
    VOTE_MAX_PER_USER,
    VOTE_WINDOW_SECONDS,
  );
  if (voteLimit.limited) return errorResponse('Too many vote changes. Please slow down.', 429);

  const isSuperAdmin2 = ['admin', 'super_admin'].includes(request.user.role);
  if (!isSuperAdmin2) {
    if (question.source_type === 'voter') {
      const err = await requireVerifiedVoter(request, env);
      if (err) return err;
    } else {
      const err = await requireApprovedPress(request, env);
      if (err) return err;
    }
  }

  // Check existing vote
  const existing = await env.ARENA_DB.prepare(
    `SELECT id FROM question_votes WHERE question_id = ? AND user_id = ?`
  ).bind(questionId, request.user.id).first();

  // Recompute vote_count from actual rows (prevents race condition desync)
  const recomputeStmt = env.ARENA_DB.prepare(
    `UPDATE questions SET vote_count = (SELECT COUNT(*) FROM question_votes WHERE question_id = ?), updated_at = datetime('now') WHERE id = ?`
  ).bind(questionId, questionId);

  if (existing) {
    // Unvote
    await env.ARENA_DB.batch([
      env.ARENA_DB.prepare(`DELETE FROM question_votes WHERE id = ?`).bind(existing.id),
      recomputeStmt,
    ]);
    const updated = await env.ARENA_DB.prepare(`SELECT vote_count FROM questions WHERE id = ?`).bind(questionId).first();
    return successResponse({ voted: false, vote_count: updated?.vote_count ?? 0 });
  } else {
    // Upvote — INSERT OR IGNORE prevents UNIQUE violation in concurrent requests
    const voteId = generateId('qv');
    await env.ARENA_DB.batch([
      env.ARENA_DB.prepare(`INSERT OR IGNORE INTO question_votes (id, question_id, user_id) VALUES (?, ?, ?)`).bind(voteId, questionId, request.user.id),
      recomputeStmt,
    ]);
    const updated = await env.ARENA_DB.prepare(`SELECT vote_count FROM questions WHERE id = ?`).bind(questionId).first();
    return successResponse({ voted: true, vote_count: updated?.vote_count ?? 0 });
  }
});

// 404 for unknown question routes
router.all('*', () => errorResponse('Questions endpoint not found', 404));

export default router;
