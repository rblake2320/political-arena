/**
 * Arena - Public stats and live feed routes
 * Lightweight read endpoints for launch/home surfaces.
 */

import { Router } from 'itty-router';
import { sendAndRecordTransactionalEmail, transactionalEmailStatus } from '../email.js';
import { errorResponse, parseBody, requireRole, successResponse } from '../middleware.js';
import { validate, launchEmailTestSchema } from '../validation.js';

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

function gate(ok, details, blocker) {
  return { ok, ...details, ...(ok || !blocker ? {} : { blocker }) };
}

function sourceBreakdown(rows) {
  return Object.fromEntries((rows || []).map(row => [row.source_status || 'unknown', Number(row.count || 0)]));
}

// GET /api/stats/readiness - admin launch-readiness checklist
router.get('/stats/readiness', async (request, env) => {
  const authError = await requireRole('admin', 'super_admin')(request, env);
  if (authError) return authError;

  const [
    raceStats,
    candidateStats,
    candidateSources,
    challengeStats,
    correctionStats,
    anchorStats,
  ] = await Promise.all([
    env.ARENA_DB.prepare(
      `SELECT
         COUNT(*) as active_races,
         SUM(CASE WHEN NOT EXISTS (
           SELECT 1 FROM candidates c WHERE c.race_id = r.id AND c.is_active = 1
         ) THEN 1 ELSE 0 END) as active_races_without_candidates
       FROM races r
       WHERE r.status = 'active'`
    ).first(),
    env.ARENA_DB.prepare(
      `SELECT
         COUNT(*) as active_candidates,
         SUM(CASE WHEN source_status IS NULL OR source_label IS NULL THEN 1 ELSE 0 END) as missing_provenance
       FROM candidates
       WHERE is_active = 1`
    ).first(),
    env.ARENA_DB.prepare(
      `SELECT COALESCE(source_status, 'unknown') as source_status, COUNT(*) as count
       FROM candidates
       WHERE is_active = 1
       GROUP BY COALESCE(source_status, 'unknown')
       ORDER BY source_status`
    ).all(),
    env.ARENA_DB.prepare(
      `SELECT
         COUNT(*) as total_callouts,
         SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_callouts,
         SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired_callouts,
         SUM(CASE WHEN status = 'expired' AND notice_status = 'unserved' THEN 1 ELSE 0 END) as unserved_expired_callouts,
         SUM(CASE WHEN notice_status != 'unserved' THEN 1 ELSE 0 END) as served_callouts
       FROM challenges
       WHERE is_visible = 1`
    ).first(),
    env.ARENA_DB.prepare(
      `SELECT
         COUNT(*) as total_corrections,
         SUM(CASE WHEN status IN ('open','under_review') THEN 1 ELSE 0 END) as open_corrections
       FROM correction_requests`
    ).first(),
    env.ARENA_DB.prepare(
      `SELECT COUNT(*) as anchor_count, MAX(anchored_at) as latest_anchor_at
       FROM audit_anchors`
    ).first(),
  ]);

  const email = transactionalEmailStatus(env);
  const r2Configured = !!env.ARENA_MEDIA;
  const wormConfirmed = String(env.AUDIT_ANCHOR_WORM_CONFIRMED || '').toLowerCase() === 'true';
  const activeRaces = Number(raceStats?.active_races || 0);
  const activeRacesWithoutCandidates = Number(raceStats?.active_races_without_candidates || 0);
  const activeCandidates = Number(candidateStats?.active_candidates || 0);
  const missingProvenance = Number(candidateStats?.missing_provenance || 0);
  const unservedExpired = Number(challengeStats?.unserved_expired_callouts || 0);
  const anchorCount = Number(anchorStats?.anchor_count || 0);

  const gates = {
    production_environment: gate(env.ENVIRONMENT === 'production', {
      environment: env.ENVIRONMENT || null,
    }, 'ENVIRONMENT must be production.'),
    race_data: gate(activeRaces >= 512 && activeRacesWithoutCandidates === 0, {
      active_races: activeRaces,
      active_races_without_candidates: activeRacesWithoutCandidates,
      expected_minimum_active_races: 512,
    }, 'Production should have the 2026 race universe loaded and no active race without candidates.'),
    candidate_provenance: gate(activeCandidates > 0 && missingProvenance === 0, {
      active_candidates: activeCandidates,
      missing_provenance: missingProvenance,
      by_source_status: sourceBreakdown(candidateSources.results || []),
    }, 'Every active candidate should carry a source/provenance label.'),
    correction_appeal: gate(true, {
      public_history_path: '/api/corrections/public',
      submit_path: '/api/corrections',
      moderation_queue_path: '/api/corrections/pending',
      open_corrections: Number(correctionStats?.open_corrections || 0),
      total_corrections: Number(correctionStats?.total_corrections || 0),
    }),
    moderator_rubric: gate(true, {
      public_path: '/api/statements/review-rubric',
      second_review_queue_path: '/api/statements/review-pending',
    }),
    served_notice_gate: gate(unservedExpired === 0, {
      total_callouts: Number(challengeStats?.total_callouts || 0),
      open_callouts: Number(challengeStats?.open_callouts || 0),
      served_callouts: Number(challengeStats?.served_callouts || 0),
      expired_callouts: Number(challengeStats?.expired_callouts || 0),
      unserved_expired_callouts: unservedExpired,
    }, 'Unserved callouts must not be expired into public non-response.'),
    transactional_email: gate(email.configured, {
      configured: email.configured,
      provider: email.provider,
      missing: email.missing,
    }, 'Configure Resend or Postmark secrets before served external notices and password reset can be launch-ready.'),
    r2_media_storage: gate(r2Configured, {
      configured: r2Configured,
    }, 'R2 media binding is required for uploads and audit anchor manifests.'),
    audit_anchor: gate(anchorCount > 0 && wormConfirmed, {
      anchor_count: anchorCount,
      latest_anchor_at: anchorStats?.latest_anchor_at || null,
      worm_confirmed: wormConfirmed,
      confirmation_env: 'AUDIT_ANCHOR_WORM_CONFIRMED=true',
    }, 'Publish at least one audit anchor and confirm R2 Bucket Lock / WORM retention on the anchor prefix.'),
  };

  const blockers = Object.entries(gates)
    .filter(([, value]) => !value.ok)
    .map(([name, value]) => ({ gate: name, reason: value.blocker || 'Not ready' }));

  return successResponse({
    checked_at: new Date().toISOString(),
    launch_ready: blockers.length === 0,
    blockers,
    gates,
  });
});

// POST /api/stats/readiness/email-test - admin transactional email smoke
router.post('/stats/readiness/email-test', async (request, env) => {
  const authError = await requireRole('admin', 'super_admin')(request, env);
  if (authError) return authError;

  const body = await parseBody(request).catch(() => ({}));
  const { valid, errors, data } = validate(launchEmailTestSchema, body || {});
  if (!valid) return errorResponse(errors.join('; '));

  const email = transactionalEmailStatus(env);
  if (!email.configured) {
    return errorResponse(`Transactional email is not configured: ${email.missing.join(', ')}`, 503);
  }

  const recipient = data.to_email || request.user.email;
  try {
    const result = await sendAndRecordTransactionalEmail(env.ARENA_DB, env, {
      to: recipient,
      subject: 'Arena launch readiness email test',
      text: [
        'Arena transactional email is configured.',
        '',
        `Requested by: ${request.user.email}`,
        `Checked at: ${new Date().toISOString()}`,
      ].join('\n'),
      html: `
        <p><strong>Arena transactional email is configured.</strong></p>
        <p>Requested by: ${request.user.email}</p>
        <p>Checked at: ${new Date().toISOString()}</p>
      `,
      tag: 'launch_readiness_email_test',
      metadata: {
        requested_by: request.user.id,
        readiness_check: 'transactional_email',
      },
      idempotencyKey: `launch-email-test-${request.user.id}-${Date.now()}`,
    }, {
      recipient_user_id: data.to_email ? null : request.user.id,
      related_entity_type: 'system',
      related_entity_id: 'launch-readiness',
      template_key: 'launch_readiness_email_test',
    });

    return successResponse({
      delivered: !!result.delivered,
      provider: result.provider || email.provider,
      provider_message_id: result.provider_message_id || null,
      recipient,
    });
  } catch (error) {
    return errorResponse(`Transactional email test failed: ${String(error?.message || error)}`, 502);
  }
});

// GET /api/stats/cycle - public launch counters
router.get('/stats/cycle', async (request, env) => {
  const [raceStats, challengeStats] = await Promise.all([
    env.ARENA_DB.prepare(
      `SELECT COUNT(*) as races_live FROM races WHERE status = 'active'`
    ).first(),
    env.ARENA_DB.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END), 0) as open_callouts,
         COALESCE(SUM(CASE WHEN status IN ('responded','refused','withdrawn') OR (status = 'expired' AND notice_status != 'unserved') THEN 1 ELSE 0 END), 0) as resolved_callouts,
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
       WHERE ch.is_visible = 1 AND ch.expired_at IS NOT NULL AND ch.notice_status != 'unserved'
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
