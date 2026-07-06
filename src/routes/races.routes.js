/**
 * Arena — Race Routes
 * GET /api/races, GET /api/races/:id, POST /api/races, PUT /api/races/:id
 */

import { Router } from 'itty-router';
import { generateId } from '../db.js';
import { auditLog } from '../audit.js';
import { requireAuth, requireRole, errorResponse, successResponse, parseBody, getClientIP, optionalAuth } from '../middleware.js';
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

async function getReciteSummaries(db, items, contentType) {
  const itemIds = items.map(item => item.id);
  const summaries = new Map();

  for (const itemId of itemIds) {
    summaries.set(itemId, {
      recite_count: 0,
      fact_score: computeFactScore([]),
      top_source: null,
    });
  }

  if (itemIds.length === 0) return summaries;

  const placeholders = itemIds.map(() => '?').join(',');
  const result = await db.prepare(
    `SELECT id, content_id, url, title, publisher, source_type, stance, status, archive_url
     FROM recites
     WHERE content_type = ?
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
  ).bind(contentType, ...itemIds).all();

  const recitesByItem = new Map();
  for (const recite of result.results || []) {
    const recites = recitesByItem.get(recite.content_id) || [];
    recites.push(recite);
    recitesByItem.set(recite.content_id, recites);
  }

  for (const [itemId, recites] of recitesByItem.entries()) {
    summaries.set(itemId, {
      recite_count: recites.length,
      fact_score: computeFactScore(recites),
      top_source: topSourceForRecites(recites),
    });
  }

  return summaries;
}

const getChallengeReciteSummaries = (db, challenges) => getReciteSummaries(db, challenges, 'challenge');
const getAdReciteSummaries = (db, ads) => getReciteSummaries(db, ads, 'ad');

function safeParseIssuePositions(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function percent(numerator, denominator, defaultValue = null) {
  if (!denominator) return defaultValue;
  return Number(((numerator / denominator) * 100).toFixed(1));
}

async function getCandidateComparisonStats(db, candidateIds) {
  const stats = new Map();
  for (const id of candidateIds) {
    stats.set(id, {
      targeted_challenges: {
        total: 0,
        open: 0,
        responded: 0,
        expired: 0,
        refused: 0,
        withdrawn: 0,
        response_rate: null,
      },
      issued_challenges: { total: 0 },
      ads: { total: 0 },
      rebuttals: { total: 0 },
      statements: {
        total: 0,
        supported: 0,
        disputed_or_false: 0,
        dodged: 0,
        avg_evasion_score: null,
      },
      verified_recites: { total: 0 },
    });
  }

  if (candidateIds.length === 0) return stats;

  const placeholders = candidateIds.map(() => '?').join(',');
  const [
    targetedResult,
    issuedResult,
    adsResult,
    rebuttalsResult,
    statementsResult,
    recitesResult,
  ] = await Promise.all([
    db.prepare(
      `SELECT
         target_candidate_id as candidate_id,
         COUNT(*) as total,
         SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
         SUM(CASE WHEN status = 'responded' THEN 1 ELSE 0 END) as responded,
         SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired,
         SUM(CASE WHEN status = 'refused' THEN 1 ELSE 0 END) as refused,
         SUM(CASE WHEN status = 'withdrawn' THEN 1 ELSE 0 END) as withdrawn
       FROM challenges
       WHERE target_candidate_id IN (${placeholders}) AND is_visible = 1
       GROUP BY target_candidate_id`
    ).bind(...candidateIds).all(),
    db.prepare(
      `SELECT challenger_candidate_id as candidate_id, COUNT(*) as total
       FROM challenges
       WHERE challenger_candidate_id IN (${placeholders}) AND is_visible = 1
       GROUP BY challenger_candidate_id`
    ).bind(...candidateIds).all(),
    db.prepare(
      `SELECT candidate_id, COUNT(*) as total
       FROM ad_flights
       WHERE candidate_id IN (${placeholders}) AND status IN ('approved','active','completed')
       GROUP BY candidate_id`
    ).bind(...candidateIds).all(),
    db.prepare(
      `SELECT candidate_id, COUNT(*) as total
       FROM rebuttal_ads
       WHERE candidate_id IN (${placeholders}) AND status IN ('approved','active','completed')
       GROUP BY candidate_id`
    ).bind(...candidateIds).all(),
    db.prepare(
      `SELECT
         candidate_id,
         COUNT(*) as total,
         AVG(evasion_score) as avg_evasion_score,
         SUM(CASE WHEN answer_status = 'dodged' THEN 1 ELSE 0 END) as dodged,
         SUM(CASE WHEN truth_status IN ('disputed','false') THEN 1 ELSE 0 END) as disputed_or_false,
         SUM(CASE WHEN truth_status = 'supported' THEN 1 ELSE 0 END) as supported
       FROM public_statements
       WHERE candidate_id IN (${placeholders}) AND is_public = 1
       GROUP BY candidate_id`
    ).bind(...candidateIds).all(),
    db.prepare(
      `SELECT candidate_id, SUM(total) as total
       FROM (
         SELECT ch.challenger_candidate_id as candidate_id, COUNT(r.id) as total
         FROM recites r
         JOIN challenges ch ON r.content_type = 'challenge' AND r.content_id = ch.id
         WHERE r.status = 'verified' AND ch.challenger_candidate_id IN (${placeholders})
         GROUP BY ch.challenger_candidate_id
         UNION ALL
         SELECT ch.target_candidate_id as candidate_id, COUNT(r.id) as total
         FROM recites r
         JOIN challenges ch ON r.content_type = 'challenge' AND r.content_id = ch.id
         WHERE r.status = 'verified' AND ch.target_candidate_id IN (${placeholders})
         GROUP BY ch.target_candidate_id
         UNION ALL
         SELECT af.candidate_id, COUNT(r.id) as total
         FROM recites r
         JOIN ad_flights af ON r.content_type = 'ad' AND r.content_id = af.id
         WHERE r.status = 'verified' AND af.candidate_id IN (${placeholders})
         GROUP BY af.candidate_id
         UNION ALL
         SELECT ra.candidate_id, COUNT(r.id) as total
         FROM recites r
         JOIN rebuttal_ads ra ON r.content_type = 'rebuttal' AND r.content_id = ra.id
         WHERE r.status = 'verified' AND ra.candidate_id IN (${placeholders})
         GROUP BY ra.candidate_id
         UNION ALL
         SELECT cr.candidate_id, COUNT(r.id) as total
         FROM recites r
         JOIN challenge_responses cr ON r.content_type = 'challenge_response' AND r.content_id = cr.id
         WHERE r.status = 'verified' AND cr.candidate_id IN (${placeholders})
         GROUP BY cr.candidate_id
       )
       GROUP BY candidate_id`
    ).bind(
      ...candidateIds,
      ...candidateIds,
      ...candidateIds,
      ...candidateIds,
      ...candidateIds,
    ).all(),
  ]);

  for (const row of targetedResult.results || []) {
    const current = stats.get(row.candidate_id);
    const total = row.total || 0;
    const responded = row.responded || 0;
    current.targeted_challenges = {
      total,
      open: row.open || 0,
      responded,
      expired: row.expired || 0,
      refused: row.refused || 0,
      withdrawn: row.withdrawn || 0,
      response_rate: percent(responded, total),
    };
  }

  for (const row of issuedResult.results || []) {
    stats.get(row.candidate_id).issued_challenges = { total: row.total || 0 };
  }

  for (const row of adsResult.results || []) {
    stats.get(row.candidate_id).ads = { total: row.total || 0 };
  }

  for (const row of rebuttalsResult.results || []) {
    stats.get(row.candidate_id).rebuttals = { total: row.total || 0 };
  }

  for (const row of statementsResult.results || []) {
    stats.get(row.candidate_id).statements = {
      total: row.total || 0,
      supported: row.supported || 0,
      disputed_or_false: row.disputed_or_false || 0,
      dodged: row.dodged || 0,
      avg_evasion_score: row.avg_evasion_score === null ? null : Math.round(Number(row.avg_evasion_score)),
    };
  }

  for (const row of recitesResult.results || []) {
    stats.get(row.candidate_id).verified_recites = { total: row.total || 0 };
  }

  return stats;
}

// GET /api/races — Public, filterable, with activity counts for trending
router.get('/', async (request, env) => {
  const url = new URL(request.url);
  const rawPage = parseInt(url.searchParams.get('page') || '1');
  const rawLimit = parseInt(url.searchParams.get('limit') || '20');
  const page = Math.max(1, Number.isFinite(rawPage) ? rawPage : 1);
  const limit = Math.min(600, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 20));
  const offset = (page - 1) * limit;
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
    const candidateRows = [];
    const openCalloutRows = [];
    const chunkSize = 90;

    for (let i = 0; i < raceIds.length; i += chunkSize) {
      const chunk = raceIds.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => '?').join(',');
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
        ).bind(...chunk).all(),
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
        ).bind(...chunk).all(),
      ]);

      candidateRows.push(...(candidateSummaries.results || []));
      openCalloutRows.push(...(openCallouts.results || []));
    }

    for (const candidate of candidateRows) {
      const list = candidatesByRace.get(candidate.race_id) || [];
      list.push({ name: candidate.name, party: candidate.party });
      candidatesByRace.set(candidate.race_id, list);
    }

    for (const callout of openCalloutRows) {
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

// GET /api/races/:id/compare — Public side-by-side accountability metrics
router.get('/:id/compare', async (request, env) => {
  const { id } = request.params;

  const race = await env.ARENA_DB.prepare(
    `SELECT id, name, office, state, district, jurisdiction_level, election_date, status, description
     FROM races WHERE id = ?`
  ).bind(id).first();
  if (!race) return errorResponse('Race not found', 404);

  const candidatesResult = await env.ARENA_DB.prepare(
    `SELECT
       id, race_id, name, party, biography, issue_positions, photo_url, website_url,
       source_status, source_url, source_label, source_updated_at,
       verification_status, created_at, updated_at
     FROM candidates
     WHERE race_id = ? AND is_active = 1
     ORDER BY CASE WHEN verification_status = 'verified' THEN 0 ELSE 1 END, name ASC`
  ).bind(id).all();

  const candidateRows = candidatesResult.results || [];
  const statsByCandidate = await getCandidateComparisonStats(
    env.ARENA_DB,
    candidateRows.map(candidate => candidate.id)
  );

  return successResponse({
    race,
    candidates: candidateRows.map(candidate => ({
      id: candidate.id,
      race_id: candidate.race_id,
      name: candidate.name,
      party: candidate.party,
      biography: candidate.biography,
      issue_positions: safeParseIssuePositions(candidate.issue_positions),
      photo_url: candidate.photo_url,
      website_url: candidate.website_url,
      source_status: candidate.source_status,
      source_url: candidate.source_url,
      source_label: candidate.source_label,
      source_updated_at: candidate.source_updated_at,
      verification_status: candidate.verification_status,
      created_at: candidate.created_at,
      updated_at: candidate.updated_at,
      accountability: statsByCandidate.get(candidate.id),
    })),
    metric_note: 'Comparison metrics are procedural counts from public platform records, not endorsements or ballot-certification claims.',
    generated_at: new Date().toISOString(),
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
  const ads = adsResult.results || [];
  const adReciteSummaries = await getAdReciteSummaries(env.ARENA_DB, ads);

  return successResponse({
    ...race,
    candidates,
    ads: ads.map(ad => ({
      ...ad,
      ad_recite_summary: adReciteSummaries.get(ad.id) || {
        recite_count: 0,
        fact_score: computeFactScore([]),
        top_source: null,
      },
    })),
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
