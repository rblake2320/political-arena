/**
 * Arena - Public stats and live feed routes
 * Lightweight read endpoints for launch/home surfaces.
 */

import { Router } from 'itty-router';
import { errorResponse, successResponse } from '../middleware.js';

const router = Router({ base: '/api' });
const CYCLE_ELECTION_DATE = '2026-11-03';

function parseLimit(request, fallback = 20, max = 50) {
  const url = new URL(request.url);
  const rawLimit = parseInt(url.searchParams.get('limit') || `${fallback}`, 10);
  if (!Number.isFinite(rawLimit)) return fallback;
  return Math.min(max, Math.max(1, rawLimit));
}

function raceLabel(row) {
  if (row.race_name) return row.race_name;
  const district = row.race_district ? ` District ${row.race_district}` : '';
  return `${row.race_state} ${row.race_office}${district}`.trim();
}

// GET /api/stats/cycle - public launch counters
router.get('/stats/cycle', async (request, env) => {
  const [raceStats, challengeStats] = await Promise.all([
    env.ARENA_DB.prepare(
      `SELECT COUNT(*) as races_live FROM races WHERE status = 'active'`
    ).first(),
    env.ARENA_DB.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END), 0) as open_callouts,
         COALESCE(SUM(CASE WHEN status IN ('responded','expired','refused','withdrawn') THEN 1 ELSE 0 END), 0) as resolved_callouts,
         COALESCE(SUM(CASE WHEN status = 'responded' THEN 1 ELSE 0 END), 0) as responded_callouts
       FROM challenges
       WHERE is_visible = 1`
    ).first(),
  ]);

  const resolved = Number(challengeStats?.resolved_callouts || 0);
  const responded = Number(challengeStats?.responded_callouts || 0);
  const responseRate = resolved > 0 ? Math.round((responded / resolved) * 100) : 0;

  return successResponse({
    races_live: Number(raceStats?.races_live || 0),
    open_callouts: Number(challengeStats?.open_callouts || 0),
    response_rate: responseRate,
    election_date: CYCLE_ELECTION_DATE,
  });
});

// GET /api/feed/live - public challenge lifecycle ticker
router.get('/feed/live', async (request, env) => {
  const limit = parseLimit(request);
  const result = await env.ARENA_DB.prepare(
    `SELECT * FROM (
       SELECT
         'issued' as event_type,
         ch.created_at as event_at,
         ch.id as challenge_id,
         ch.public_receipt_slug as public_receipt_slug,
         r.id as race_id,
         r.name as race_name,
         r.state as race_state,
         r.office as race_office,
         r.district as race_district,
         challenger.id as challenger_candidate_id,
         challenger.name as challenger_name,
         challenger.party as challenger_party,
         target.id as target_candidate_id,
         target.name as target_name,
         target.party as target_party
       FROM challenges ch
       JOIN races r ON r.id = ch.race_id
       JOIN candidates challenger ON challenger.id = ch.challenger_candidate_id
       JOIN candidates target ON target.id = ch.target_candidate_id
       WHERE ch.is_visible = 1

       UNION ALL

       SELECT
         'responded' as event_type,
         COALESCE(ch.responded_at, cr.created_at) as event_at,
         ch.id as challenge_id,
         ch.public_receipt_slug as public_receipt_slug,
         r.id as race_id,
         r.name as race_name,
         r.state as race_state,
         r.office as race_office,
         r.district as race_district,
         challenger.id as challenger_candidate_id,
         challenger.name as challenger_name,
         challenger.party as challenger_party,
         target.id as target_candidate_id,
         target.name as target_name,
         target.party as target_party
       FROM challenge_responses cr
       JOIN challenges ch ON ch.id = cr.challenge_id
       JOIN races r ON r.id = ch.race_id
       JOIN candidates challenger ON challenger.id = ch.challenger_candidate_id
       JOIN candidates target ON target.id = ch.target_candidate_id
       WHERE ch.is_visible = 1

       UNION ALL

       SELECT
         'refused' as event_type,
         ch.refused_at as event_at,
         ch.id as challenge_id,
         ch.public_receipt_slug as public_receipt_slug,
         r.id as race_id,
         r.name as race_name,
         r.state as race_state,
         r.office as race_office,
         r.district as race_district,
         challenger.id as challenger_candidate_id,
         challenger.name as challenger_name,
         challenger.party as challenger_party,
         target.id as target_candidate_id,
         target.name as target_name,
         target.party as target_party
       FROM challenges ch
       JOIN races r ON r.id = ch.race_id
       JOIN candidates challenger ON challenger.id = ch.challenger_candidate_id
       JOIN candidates target ON target.id = ch.target_candidate_id
       WHERE ch.is_visible = 1 AND ch.refused_at IS NOT NULL

       UNION ALL

       SELECT
         'expired' as event_type,
         ch.expired_at as event_at,
         ch.id as challenge_id,
         ch.public_receipt_slug as public_receipt_slug,
         r.id as race_id,
         r.name as race_name,
         r.state as race_state,
         r.office as race_office,
         r.district as race_district,
         challenger.id as challenger_candidate_id,
         challenger.name as challenger_name,
         challenger.party as challenger_party,
         target.id as target_candidate_id,
         target.name as target_name,
         target.party as target_party
       FROM challenges ch
       JOIN races r ON r.id = ch.race_id
       JOIN candidates challenger ON challenger.id = ch.challenger_candidate_id
       JOIN candidates target ON target.id = ch.target_candidate_id
       WHERE ch.is_visible = 1 AND ch.expired_at IS NOT NULL
     )
     WHERE event_at IS NOT NULL
     ORDER BY event_at DESC
     LIMIT ?`
  ).bind(limit).all();

  return successResponse({
    events: (result.results || []).map(row => ({
      event_type: row.event_type,
      event_at: row.event_at,
      challenge_id: row.challenge_id,
      public_receipt_slug: row.public_receipt_slug || null,
      race_id: row.race_id,
      race_label: raceLabel(row),
      race_state: row.race_state,
      race_office: row.race_office,
      race_district: row.race_district || null,
      challenger_candidate_id: row.challenger_candidate_id,
      challenger_name: row.challenger_name,
      challenger_party: row.challenger_party,
      target_candidate_id: row.target_candidate_id,
      target_name: row.target_name,
      target_party: row.target_party,
    })),
    limit,
  });
});

router.all('*', () => errorResponse('Stats endpoint not found', 404));

export default router;
