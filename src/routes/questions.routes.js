/**
 * Arena — Questions Routes
 * Voter + Press questions per race, upvote/downvote, top-5 bubbling
 */

import { Router } from 'itty-router';
import { generateId } from '../db.js';
import {
  requireAuth, requireVerifiedVoter, requireApprovedPress, requireRole,
  optionalAuth, successResponse, errorResponse, parsePagination, parseBody, getClientIP, json,
} from '../middleware.js';
import { auditLog } from '../audit.js';
import { validate, submitQuestionSchema } from '../validation.js';
import { checkRateLimit } from '../ratelimit.js';
import { notifySubscribers } from '../notifications.js';
import { emptyVoteBreakdown, integrityLimits, jurisdictionMatch, questionFingerprint } from '../integrity.js';

const router = Router({ base: '/api/questions' });
const VOTE_MAX_PER_USER = 20;
const VOTE_WINDOW_SECONDS = 10 * 60;

// Fields safe to publish. Never return the author's user id or the dedup fingerprint.
const PUBLIC_QUESTION_COLUMNS = `q.id, q.race_id, q.source_type, q.question_text, q.media_url, q.vote_count,
  q.status, q.author_jurisdiction, q.created_at, q.updated_at, u.display_name as author_name`;

/**
 * Attach the per-jurisdiction vote breakdown to each question. Location is
 * self-reported profile data: a label for readers, not proof of residency.
 */
async function attachVoteBreakdown(db, questions) {
  const byId = new Map(questions.map(q => [q.id, { ...q, vote_breakdown: emptyVoteBreakdown() }]));
  const ids = [...byId.keys()];
  // D1 caps bound parameters at 100 per statement — chunk the IN list.
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const rows = await db.prepare(
      `SELECT question_id, voter_jurisdiction, COUNT(*) as cnt FROM question_votes
       WHERE question_id IN (${chunk.map(() => '?').join(',')})
       GROUP BY question_id, voter_jurisdiction`
    ).bind(...chunk).all();
    for (const row of rows.results || []) {
      const breakdown = byId.get(row.question_id)?.vote_breakdown;
      if (breakdown && row.voter_jurisdiction in breakdown) breakdown[row.voter_jurisdiction] = row.cnt;
    }
  }
  return [...byId.values()];
}

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

  // sort=local ranks by votes from people who report living in the race's
  // jurisdiction. The default order is unchanged: total votes, never reweighted.
  const sortLocal = url.searchParams.get('sort') === 'local';
  let query = `SELECT ${PUBLIC_QUESTION_COLUMNS},
      (SELECT COUNT(*) FROM question_votes qv WHERE qv.question_id = q.id AND qv.voter_jurisdiction = 'in_jurisdiction') as local_votes
    FROM questions q JOIN users u ON q.user_id = u.id WHERE q.race_id = ? AND q.status = 'active'`;
  const binds = [raceId];

  if (sourceType && (sourceType === 'voter' || sourceType === 'press')) {
    query += ` AND q.source_type = ?`;
    binds.push(sourceType);
  }

  query += sortLocal
    ? ` ORDER BY local_votes DESC, q.vote_count DESC, q.created_at DESC LIMIT ? OFFSET ?`
    : ` ORDER BY q.vote_count DESC, q.created_at DESC LIMIT ? OFFSET ?`;
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
    // D1 caps bound parameters at 100 per statement — chunk the IN list.
    for (let i = 0; i < qIds.length; i += 90) {
      const chunk = qIds.slice(i, i + 90);
      const placeholders = chunk.map(() => '?').join(',');
      const votes = await env.ARENA_DB.prepare(
        `SELECT question_id FROM question_votes WHERE user_id = ? AND question_id IN (${placeholders})`
      ).bind(request.user.id, ...chunk).all();
      for (const v of votes.results) {
        userVotes[v.question_id] = true;
      }
    }
  }

  // Mark top 5 per source_type
  const withBreakdown = await attachVoteBreakdown(env.ARENA_DB, questions.results);
  const enriched = withBreakdown.map((q, idx) => ({
    ...q,
    has_voted: !!userVotes[q.id],
    is_top: idx < 5 && offset === 0,
  }));

  return successResponse({
    questions: enriched,
    pagination: { page, limit, total: total.total },
    sort: sortLocal ? 'local' : 'votes',
    jurisdiction_note: 'Location labels come from self-reported profile data. They are not verified residency or voter eligibility.',
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
      `SELECT ${PUBLIC_QUESTION_COLUMNS} FROM questions q JOIN users u ON q.user_id = u.id WHERE q.race_id = ? AND q.source_type = 'voter' AND q.status = 'active' ORDER BY q.vote_count DESC LIMIT 5`
    ).bind(raceId).all(),
    env.ARENA_DB.prepare(
      `SELECT ${PUBLIC_QUESTION_COLUMNS} FROM questions q JOIN users u ON q.user_id = u.id WHERE q.race_id = ? AND q.source_type = 'press' AND q.status = 'active' ORDER BY q.vote_count DESC LIMIT 5`
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
    voter_questions: enrich(await attachVoteBreakdown(env.ARENA_DB, voterQ.results)),
    press_questions: enrich(await attachVoteBreakdown(env.ARENA_DB, pressQ.results)),
  });
});

function duplicateQuestionResponse(existingQuestionId) {
  return json({
    success: false,
    error: 'This question has already been asked in this race. Upvote the existing question instead.',
    existing_question_id: existingQuestionId,
  }, 409);
}

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
  const race = await env.ARENA_DB.prepare(`SELECT id, office, state, district FROM races WHERE id = ?`).bind(raceId).first();
  if (!race) return errorResponse('Race not found', 404);

  const limits = integrityLimits(env);
  const fingerprint = await questionFingerprint(data.question_text);
  if (!fingerprint) return errorResponse('Question must contain letters or numbers');

  // Duplicate: point the reader at the question that already exists so they
  // can upvote it. A wall of identical questions is not more accountability.
  const duplicate = await env.ARENA_DB.prepare(
    `SELECT id FROM questions WHERE race_id = ? AND text_fingerprint = ? AND status = 'active' LIMIT 1`
  ).bind(raceId, fingerprint).first();
  if (duplicate) return duplicateQuestionResponse(duplicate.id);

  const [raceDayCount, userDayCount, raceHourCount, account] = await Promise.all([
    env.ARENA_DB.prepare(
      `SELECT COUNT(*) as cnt FROM questions WHERE user_id = ? AND race_id = ? AND created_at > datetime('now', '-1 day')`
    ).bind(request.user.id, raceId).first(),
    env.ARENA_DB.prepare(
      `SELECT COUNT(*) as cnt FROM questions WHERE user_id = ? AND created_at > datetime('now', '-1 day')`
    ).bind(request.user.id).first(),
    env.ARENA_DB.prepare(
      `SELECT COUNT(*) as cnt FROM questions WHERE race_id = ? AND created_at > datetime('now', '-1 hour')`
    ).bind(raceId).first(),
    env.ARENA_DB.prepare(
      `SELECT created_at > datetime('now', ?) as is_new FROM users WHERE id = ?`
    ).bind(`-${limits.newAccountDays} days`, request.user.id).first(),
  ]);
  if (raceDayCount.cnt >= limits.questionsPerUserPerRacePerDay) {
    return errorResponse(`You can submit up to ${limits.questionsPerUserPerRacePerDay} questions per race per day`, 429);
  }
  if (userDayCount.cnt >= limits.questionsPerUserPerDay) {
    return errorResponse(`You can submit up to ${limits.questionsPerUserPerDay} questions per day across all races`, 429);
  }
  // Surge guard: when a race is flooded, only brand-new accounts are slowed.
  // Established accounts keep asking, so a flood cannot silence real voters.
  if (raceHourCount.cnt >= limits.raceSurgePerHour && account?.is_new) {
    return errorResponse(
      `This race is receiving an unusually high number of questions. Accounts newer than ${limits.newAccountDays} days can upvote existing questions now and submit new ones later.`,
      429,
    );
  }

  const id = generateId('q');
  const authorJurisdiction = jurisdictionMatch(request.user, race);
  try {
    await env.ARENA_DB.prepare(
      `INSERT INTO questions (id, race_id, user_id, source_type, question_text, media_url, text_fingerprint, author_jurisdiction)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, raceId, request.user.id, data.source_type, data.question_text, data.media_url || null, fingerprint, authorJurisdiction).run();
  } catch (error) {
    // Two identical submissions raced; the unique index kept exactly one.
    if (String(error?.message || error).includes('UNIQUE')) {
      const winner = await env.ARENA_DB.prepare(
        `SELECT id FROM questions WHERE race_id = ? AND text_fingerprint = ? AND status = 'active' LIMIT 1`
      ).bind(raceId, fingerprint).first();
      return duplicateQuestionResponse(winner?.id || null);
    }
    throw error;
  }

  await notifySubscribers(env.ARENA_DB, {
    raceId,
    notificationType: 'question_submitted',
    title: `${data.source_type === 'press' ? 'Press' : 'Voter'} question submitted`,
    body: data.question_text,
    linkUrl: `/race/${raceId}`,
  });

  return successResponse({ id, source_type: data.source_type, question_text: data.question_text, author_jurisdiction: authorJurisdiction });
});

/**
 * POST /api/questions/:questionId/vote — Toggle upvote
 */
router.post('/:questionId/vote', async (request, env) => {
  const { questionId } = request.params;

  // Fetch question to determine source_type
  const question = await env.ARENA_DB.prepare(
    `SELECT q.id, q.source_type, q.vote_count, r.office, r.state, r.district
     FROM questions q JOIN races r ON q.race_id = r.id
     WHERE q.id = ? AND q.status = 'active'`
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
      env.ARENA_DB.prepare(
        `INSERT OR IGNORE INTO question_votes (id, question_id, user_id, voter_jurisdiction) VALUES (?, ?, ?, ?)`
      ).bind(voteId, questionId, request.user.id, jurisdictionMatch(request.user, question)),
      recomputeStmt,
    ]);
    const updated = await env.ARENA_DB.prepare(`SELECT vote_count FROM questions WHERE id = ?`).bind(questionId).first();
    return successResponse({ voted: true, vote_count: updated?.vote_count ?? 0 });
  }
});

// 404 for unknown question routes
// PUT /api/questions/:questionId/status — Moderator hide/restore (takedown path)
router.put('/:questionId/status', async (request, env, ctx) => {
  const authError = await requireRole('moderator', 'admin', 'super_admin')(request, env);
  if (authError) return authError;

  const { questionId } = request.params;
  const body = await parseBody(request);
  const status = body?.status;
  if (!['active', 'hidden'].includes(status)) {
    return errorResponse('status must be active or hidden');
  }

  const question = await env.ARENA_DB.prepare(`SELECT id, status FROM questions WHERE id = ?`).bind(questionId).first();
  if (!question) return errorResponse('Question not found', 404);

  await env.ARENA_DB.prepare(
    `UPDATE questions SET status = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(status, questionId).run();

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: `question.${status === 'hidden' ? 'hide' : 'restore'}`,
    entityType: 'question',
    entityId: questionId,
    beforeState: { status: question.status },
    afterState: { status, reason: body?.reason || null },
    ipAddress: getClientIP(request),
  });

  return successResponse({ id: questionId, status });
});

router.all('*', () => errorResponse('Questions endpoint not found', 404));

export default router;
