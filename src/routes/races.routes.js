/**
 * Arena — Race Routes
 * GET /api/races, GET /api/races/:id, POST /api/races, PUT /api/races/:id
 */

import { Router } from 'itty-router';
import { generateId } from '../db.js';
import { auditLog } from '../audit.js';
import { requireAuth, requireRole, errorResponse, successResponse, parseBody, parsePagination, getClientIP, optionalAuth } from '../middleware.js';
import { validate, createRaceSchema, updateRaceSchema } from '../validation.js';
import { computeFactScore } from './recites.routes.js';

const router = Router({ base: '/api/races' });

function topSourceForRecites(recites) {
  const top = recites[0];
  if (!top) return null;

  return {
    title: top.title,
    publisher: top.publisher || null,
    source_type: top.source_type,
    stance: top.stance,
    status: top.status,
    url: top.url,
    archive_url: top.archive_url || null,
  };
}

async function getChallengeReciteSummaries(db, challenges) {
  const challengeIds = challenges.map(challenge => challenge.id);
  const summaries = new Map();

  for (const challengeId of challengeIds) {
    summaries.set(challengeId, {
      recite_count: 0,
      fact_score: computeFactScore([]),
      top_source: null,
    });
  }

  if (challengeIds.length === 0) return summaries;

  const placeholders = challengeIds.map(() => '?').join(',');
  const result = await db.prepare(
    `SELECT id, content_id, url, title, publisher, source_type, stance, status, archive_url
     FROM recites
     WHERE content_type = 'challenge'
       AND content_id IN (${placeholders})
       AND status != 'rejected'
     ORDER BY
       content_id,
       CASE status WHEN 'verified' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
       CASE source_type
         WHEN 'official_record' THEN 0
         WHEN 'court_record' THEN 1
         WHEN 'public_document' THEN 2
         WHEN 'research' THEN 3
         WHEN 'news' THEN 4
         WHEN 'campaign_material' THEN 5
         ELSE 6
       END,
       created_at DESC`
  ).bind(...challengeIds).all();

  const recitesByChallenge = new Map();
  for (const recite of result.results || []) {
    const recites = recitesByChallenge.get(recite.content_id) || [];
    recites.push(recite);
    recitesByChallenge.set(recite.content_id, recites);
  }

  for (const [challengeId, recites] of recitesByChallenge.entries()) {
    summaries.set(challengeId, {
      recite_count: recites.length,
      fact_score: computeFactScore(recites),
      top_source: topSourceForRecites(recites),
    });
  }

  return summaries;
}

// GET /api/races — Public, filterable, with activity counts for trending
router.get('/', async (request, env) => {
  const url = new URL(request.url);
  const { limit, offset } = parsePagination(url);
  const state = url.searchParams.get('state');
  const office = url.searchParams.get('office');
  const status = url.searchParams.get('status') || 'active';
  const sort = url.searchParams.get('sort'); // 'trending', 'newest', 'name'

  let sql = `SELECT r.*,
    (SELECT COUNT(*) FROM candidates c WHERE c.race_id = r.id AND c.is_active = 1) as candidate_count,
    (SELECT COUNT(*) FROM challenges ch WHERE ch.race_id = r.id AND ch.is_visible = 1) as challenge_count,
    (SELECT COUNT(*) FROM ad_flights af WHERE af.race_id = r.id AND af.status IN ('approved','active')) as ad_count,
    (SELECT COUNT(*) FROM questions q WHERE q.race_id = r.id AND q.status = 'active') as question_count,
    (SELECT COUNT(*) FROM challenge_responses cr JOIN challenges c2 ON cr.challenge_id = c2.id WHERE c2.race_id = r.id) as response_count
  FROM races r WHERE 1=1`;
  const binds = [];

  if (state) { sql += ` AND r.state = ?`; binds.push(state); }
  if (office) { sql += ` AND r.office = ?`; binds.push(office); }
  if (status && status !== 'all') { sql += ` AND r.status = ?`; binds.push(status); }

  if (sort === 'trending') {
    sql += ` ORDER BY (challenge_count + ad_count + question_count + response_count) DESC, r.created_at DESC`;
  } else if (sort === 'name') {
    sql += ` ORDER BY r.name ASC`;
  } else {
    sql += ` ORDER BY r.created_at DESC`;
  }
  sql += ` LIMIT ? OFFSET ?`;
  binds.push(limit, offset);

  const result = await env.ARENA_DB.prepare(sql).bind(...binds).all();

  // Compute activity_score for each race
  const baseRaces = result.results || [];
  const raceIds = baseRaces.map(r => r.id);
  const candidatesByRace = new Map();
  const openCalloutByRace = new Map();

  if (raceIds.length > 0) {
    const placeholders = raceIds.map(() => '?').join(',');
    const [candidateSummaries, openCallouts] = await Promise.all([
      env.ARENA_DB.prepare(
        `SELECT race_id, name, party FROM (
           SELECT
             c.race_id,
             c.name,
             c.party,
             ROW_NUMBER() OVER (
               PARTITION BY c.race_id
               ORDER BY CASE WHEN c.verification_status = 'verified' THEN 0 ELSE 1 END, c.name ASC
             ) as rn
           FROM candidates c
           WHERE c.race_id IN (${placeholders}) AND c.is_active = 1
         )
         WHERE rn <= 2
         ORDER BY race_id, rn`
      ).bind(...raceIds).all(),
      env.ARENA_DB.prepare(
        `SELECT race_id, target_name, claim_text, response_deadline FROM (
           SELECT
             ch.race_id,
             target.name as target_name,
             COALESCE(ch.claim_text, ch.challenge_text) as claim_text,
             ch.response_deadline,
             ROW_NUMBER() OVER (
               PARTITION BY ch.race_id
               ORDER BY ch.created_at DESC, ch.id DESC
             ) as rn
           FROM challenges ch
           JOIN candidates target ON target.id = ch.target_candidate_id
           WHERE ch.race_id IN (${placeholders})
             AND ch.status = 'open'
             AND ch.is_visible = 1
         )
         WHERE rn = 1`
      ).bind(...raceIds).all(),
    ]);

    for (const candidate of candidateSummaries.results || []) {
      const list = candidatesByRace.get(candidate.race_id) || [];
      list.push({ name: candidate.name, party: candidate.party });
      candidatesByRace.set(candidate.race_id, list);
    }

    for (const callout of openCallouts.results || []) {
      openCalloutByRace.set(callout.race_id, {
        target_name: callout.target_name,
        claim_text: callout.claim_text,
        response_deadline: callout.response_deadline,
      });
    }
  }

  const races = baseRaces.map(r => ({
    ...r,
    activity_score: (r.challenge_count || 0) + (r.ad_count || 0) + (r.question_count || 0) + (r.response_count || 0),
    candidates_summary: candidatesByRace.get(r.id) || [],
    open_callout: openCalloutByRace.get(r.id) || null,
  }));

  // Total count for pagination
  let countSql = `SELECT COUNT(*) as total FROM races WHERE 1=1`;
  const countBinds = [];
  if (state) { countSql += ` AND state = ?`; countBinds.push(state); }
  if (office) { countSql += ` AND office = ?`; countBinds.push(office); }
  if (status && status !== 'all') { countSql += ` AND status = ?`; countBinds.push(status); }
  const countResult = await env.ARENA_DB.prepare(countSql).bind(...countBinds).first();

  return successResponse({
    races,
    total: countResult.total,
    page: Math.floor(offset / limit) + 1,
    limit,
  });
});

// GET /api/races/:id — Public, full detail with candidates, ads, challenges
router.get('/:id', async (request, env) => {
  const { id } = request.params;

  const race = await env.ARENA_DB.prepare(`SELECT * FROM races WHERE id = ?`).bind(id).first();
  if (!race) return errorResponse('Race not found', 404);

  // Fetch related data in parallel
  const [candidatesResult, adsResult, rebuttalsResult, challengesResult, responsesResult] = await Promise.all([
    env.ARENA_DB.prepare(`SELECT * FROM candidates WHERE race_id = ? AND is_active = 1 ORDER BY name`).bind(id).all(),
    env.ARENA_DB.prepare(`SELECT * FROM ad_flights WHERE race_id = ? AND status IN ('approved','active') ORDER BY created_at DESC`).bind(id).all(),
    env.ARENA_DB.prepare(`SELECT * FROM rebuttal_ads WHERE race_id = ? AND status IN ('approved','active') ORDER BY created_at DESC`).bind(id).all(),
    env.ARENA_DB.prepare(`SELECT * FROM challenges WHERE race_id = ? AND is_visible = 1 ORDER BY created_at DESC`).bind(id).all(),
    env.ARENA_DB.prepare(
      `SELECT cr.* FROM challenge_responses cr
       JOIN challenges c ON cr.challenge_id = c.id
       WHERE c.race_id = ?`
    ).bind(id).all(),
  ]);

  // Parse issue_positions JSON for candidates
  const candidates = (candidatesResult.results || []).map(c => ({
    ...c,
    issue_positions: c.issue_positions ? JSON.parse(c.issue_positions) : [],
  }));

  // Lazy expiration: update expired challenges
  const now = new Date().toISOString();
  const expiredChallenges = (challengesResult.results || []).filter(
    c => c.status === 'open' && c.response_deadline < now
  );
  if (expiredChallenges.length > 0) {
    await env.ARENA_DB.batch(
      expiredChallenges.map(c =>
        env.ARENA_DB.prepare(
          `UPDATE challenges SET status = 'expired', expired_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'open'`
        ).bind(c.id)
      )
    );
    // Update in-memory results
    expiredChallenges.forEach(c => { c.status = 'expired'; c.expired_at = now; });
  }

  const challenges = challengesResult.results || [];
  const reciteSummaries = await getChallengeReciteSummaries(env.ARENA_DB, challenges);

  return successResponse({
    ...race,
    candidates,
    ads: adsResult.results || [],
    rebuttals: rebuttalsResult.results || [],
    challenges: challenges.map(challenge => ({
      ...challenge,
      challenge_recite_summary: reciteSummaries.get(challenge.id) || {
        recite_count: 0,
        fact_score: computeFactScore([]),
        top_source: null,
      },
    })),
    challengeResponses: responsesResult.results || [],
  });
});

// POST /api/races — Admin only
router.post('/', async (request, env, ctx) => {
  const authError = await requireRole('admin', 'super_admin')(request, env);
  if (authError) return authError;

  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid request body');

  const { valid, errors, data } = validate(createRaceSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  const raceId = generateId('race');
  await env.ARENA_DB.prepare(
    `INSERT INTO races (id, name, office, state, district, jurisdiction_level, election_date, filing_deadline, description, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(raceId, data.name, data.office, data.state, data.district, data.jurisdiction_level, data.election_date || null, data.filing_deadline || null, data.description || null, request.user.id).run();

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: 'race.create',
    entityType: 'race',
    entityId: raceId,
    afterState: data,
    ipAddress: getClientIP(request),
  });

  return successResponse({ id: raceId, ...data });
});

// PUT /api/races/:id — Admin only
router.put('/:id', async (request, env, ctx) => {
  const authError = await requireRole('admin', 'super_admin')(request, env);
  if (authError) return authError;

  const { id } = request.params;
  const existing = await env.ARENA_DB.prepare(`SELECT * FROM races WHERE id = ?`).bind(id).first();
  if (!existing) return errorResponse('Race not found', 404);

  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid request body');

  const { valid, errors, data } = validate(updateRaceSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) return errorResponse('No fields to update');

  fields.push(`updated_at = datetime('now')`);
  values.push(id);

  await env.ARENA_DB.prepare(
    `UPDATE races SET ${fields.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: 'race.update',
    entityType: 'race',
    entityId: id,
    beforeState: existing,
    afterState: data,
    ipAddress: getClientIP(request),
  });

  return successResponse({ id, ...data });
});

export default router;
