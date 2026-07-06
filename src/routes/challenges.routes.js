/**
 * Arena — Challenge Routes
 * State machine: open → responded/expired/refused/withdrawn
 * PATENT CORE: Challenge accountability with visible non-response
 */

import { Router } from 'itty-router';
import { generateId } from '../db.js';
import { auditLogNow, listAuditAnchors, verifyAuditChain } from '../audit.js';
import { requireAuth, errorResponse, successResponse, parseBody, parsePagination, getClientIP } from '../middleware.js';
import { validate, createChallengeSchema, respondToChallengeSchema, refuseChallengeSchema } from '../validation.js';
import { computeFactScore, getRecitesForContent } from './recites.routes.js';
import { isTransactionalEmailConfigured, sendAndRecordTransactionalEmail } from '../email.js';

const router = Router({ base: '/api/challenges' });

/**
 * Calculate deadline N business days from now (skips Sat/Sun).
 * E.g. Friday + 3 business days = Wednesday (skips Sat, Sun).
 */
function calculateBusinessDayDeadline(businessDays) {
  const date = new Date();
  let added = 0;
  while (added < businessDays) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay(); // 0=Sun, 6=Sat
    if (day !== 0 && day !== 6) added++;
  }
  // Set to end of that business day (23:59:59 UTC)
  date.setUTCHours(23, 59, 59, 999);
  return date.toISOString();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(value, max = 500) {
  const text = String(value || '').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function receiptUrlFor(request, slug) {
  const origin = new URL(request.url).origin;
  return `${origin}/challenge/${encodeURIComponent(slug)}`;
}

function buildChallengeNoticeEmail({ challenge, race, challenger, target, receiptUrl, noticeType }) {
  const claim = challenge.claim_text || challenge.challenge_text;
  const subject = noticeType === 'challenge_tagged'
    ? `Public callout issued to ${target.name}`
    : `New public callout in ${race.name}`;
  const text = [
    subject,
    '',
    `Race: ${race.name}`,
    `Challenger: ${challenger.name}`,
    `Target: ${target.name}`,
    `Response deadline: ${challenge.response_deadline}`,
    '',
    'Claim or question:',
    truncate(claim, 1200),
    '',
    `Public receipt: ${receiptUrl}`,
  ].join('\n');
  const html = `
    <p><strong>${escapeHtml(subject)}</strong></p>
    <p>
      Race: ${escapeHtml(race.name)}<br>
      Challenger: ${escapeHtml(challenger.name)}<br>
      Target: ${escapeHtml(target.name)}<br>
      Response deadline: ${escapeHtml(challenge.response_deadline)}
    </p>
    <p><strong>Claim or question</strong></p>
    <p>${escapeHtml(truncate(claim, 1200))}</p>
    <p><a href="${escapeHtml(receiptUrl)}">Open the public receipt</a></p>
  `;
  return { subject, text, html };
}

function enqueueChallengeNoticeEmails({ request, env, ctx, challenge, race, challenger, target, directStaff, subscriberRows }) {
  if (!isTransactionalEmailConfigured(env)) return;

  const receiptUrl = receiptUrlFor(request, challenge.public_receipt_slug);
  const emailTasks = [];
  const directUserIds = new Set(directStaff.map(row => row.user_id));

  for (const staff of directStaff) {
    if (!staff.email) continue;
    const message = buildChallengeNoticeEmail({
      challenge,
      race,
      challenger,
      target,
      receiptUrl,
      noticeType: 'challenge_tagged',
    });
    emailTasks.push(sendAndRecordTransactionalEmail(env.ARENA_DB, env, {
      to: staff.email,
      subject: message.subject,
      text: message.text,
      html: message.html,
      tag: 'challenge_tagged',
      metadata: {
        challenge_id: challenge.id,
        race_id: challenge.race_id,
        target_candidate_id: challenge.target_candidate_id,
      },
      idempotencyKey: `challenge-tagged-${challenge.id}-${staff.user_id}`,
    }, {
      recipient_user_id: staff.user_id,
      related_entity_type: 'challenge',
      related_entity_id: challenge.id,
      template_key: 'challenge_tagged',
    }).catch(err => console.error('Challenge tagged email failed:', err)));
  }

  for (const subscriber of subscriberRows) {
    if (!subscriber.email || directUserIds.has(subscriber.user_id)) continue;
    const message = buildChallengeNoticeEmail({
      challenge,
      race,
      challenger,
      target,
      receiptUrl,
      noticeType: 'challenge_issued',
    });
    emailTasks.push(sendAndRecordTransactionalEmail(env.ARENA_DB, env, {
      to: subscriber.email,
      subject: message.subject,
      text: message.text,
      html: message.html,
      tag: 'challenge_issued',
      metadata: {
        challenge_id: challenge.id,
        race_id: challenge.race_id,
        subscription_id: subscriber.id,
      },
      idempotencyKey: `challenge-issued-${challenge.id}-${subscriber.user_id}`,
    }, {
      recipient_user_id: subscriber.user_id,
      related_entity_type: 'challenge',
      related_entity_id: challenge.id,
      template_key: 'challenge_issued',
    }).catch(err => console.error('Challenge subscriber email failed:', err)));
  }

  if (emailTasks.length > 0) {
    ctx.waitUntil(Promise.all(emailTasks));
  }
}

// GET /api/challenges/races/:raceId — Public
router.get('/races/:raceId', async (request, env) => {
  const { raceId } = request.params;
  const url = new URL(request.url);
  const { limit, offset } = parsePagination(url);
  const status = url.searchParams.get('status'); // optional filter

  let sql = `SELECT ch.*,
    cc.name as challenger_name, cc.party as challenger_party,
    tc.name as target_name, tc.party as target_party
    FROM challenges ch
    JOIN candidates cc ON ch.challenger_candidate_id = cc.id
    JOIN candidates tc ON ch.target_candidate_id = tc.id
    WHERE ch.race_id = ? AND ch.is_visible = 1`;
  const binds = [raceId];

  if (status) { sql += ` AND ch.status = ?`; binds.push(status); }
  sql += ` ORDER BY ch.created_at DESC LIMIT ? OFFSET ?`;
  binds.push(limit, offset);

  const result = await env.ARENA_DB.prepare(sql).bind(...binds).all();

  // Lazy expiration check
  const now = new Date().toISOString();
  const challenges = (result.results || []).map(c => {
    if (c.status === 'open' && c.response_deadline < now) {
      c.status = 'expired';
      c.expired_at = now;
      // Fire async update
      env.ARENA_DB.prepare(
        `UPDATE challenges SET status = 'expired', expired_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'open'`
      ).bind(c.id).run();
    }
    return c;
  });

  // Fetch responses for responded challenges
  const respondedIds = challenges.filter(c => c.status === 'responded').map(c => c.id);
  let responses = [];
  if (respondedIds.length > 0) {
    const placeholders = respondedIds.map(() => '?').join(',');
    const respResult = await env.ARENA_DB.prepare(
      `SELECT cr.*, c.name as candidate_name FROM challenge_responses cr
       JOIN candidates c ON cr.candidate_id = c.id
       WHERE cr.challenge_id IN (${placeholders})`
    ).bind(...respondedIds).all();
    responses = respResult.results || [];
  }

  return successResponse({
    challenges: challenges.map(ch => ({
      ...ch,
      response: responses.find(r => r.challenge_id === ch.id) || null,
    })),
  });
});

// GET /api/challenges/:id — Public single challenge
router.get('/:id/receipt', async (request, env) => {
  const { id } = request.params;
  const challenge = await env.ARENA_DB.prepare(
    `SELECT ch.*,
      cc.name as challenger_name, cc.party as challenger_party,
      tc.name as target_name, tc.party as target_party,
      r.name as race_name, r.office as race_office, r.state as race_state, r.district as race_district
     FROM challenges ch
     JOIN candidates cc ON ch.challenger_candidate_id = cc.id
     JOIN candidates tc ON ch.target_candidate_id = tc.id
     JOIN races r ON ch.race_id = r.id
     WHERE (ch.id = ? OR ch.public_receipt_slug = ?) AND ch.is_visible = 1`
  ).bind(id, id).first();

  if (!challenge) return errorResponse('Challenge receipt not found', 404);

  if (challenge.status === 'open' && challenge.response_deadline < new Date().toISOString()) {
    const expiredAt = new Date().toISOString();
    const result = await env.ARENA_DB.prepare(
      `UPDATE challenges SET status = 'expired', expired_at = ?, updated_at = ? WHERE id = ? AND status = 'open'`
    ).bind(expiredAt, expiredAt, challenge.id).run();

    challenge.status = 'expired';
    challenge.expired_at = expiredAt;

    if (result.meta?.changes) {
      await auditLogNow(env.ARENA_DB, {
        actorType: 'system',
        action: 'challenge.expire',
        entityType: 'challenge',
        entityId: challenge.id,
        beforeState: { status: 'open' },
        afterState: { status: 'expired', expired_at: expiredAt, response_deadline: challenge.response_deadline },
      });
    }
  }

  const [response, challengeRecites, timelineResult, auditChain, auditAnchors] = await Promise.all([
    env.ARENA_DB.prepare(
      `SELECT cr.*, c.name as candidate_name, c.party as candidate_party
       FROM challenge_responses cr
       JOIN candidates c ON cr.candidate_id = c.id
       WHERE cr.challenge_id = ?`
    ).bind(challenge.id).first(),
    getRecitesForContent(env.ARENA_DB, 'challenge', challenge.id, false),
    env.ARENA_DB.prepare(
      `SELECT action, actor_id, before_state, after_state, created_at, prev_hash, entry_hash, chain_seq
       FROM audit_log
       WHERE entity_type = 'challenge' AND entity_id = ?
       ORDER BY chain_seq ASC, created_at ASC, id ASC`
    ).bind(challenge.id).all(),
    verifyAuditChain(env.ARENA_DB, { entityType: 'challenge', entityId: challenge.id }),
    listAuditAnchors(env.ARENA_DB, { entityType: 'challenge', entityId: challenge.id, limit: 5 }),
  ]);

  const responseRecites = response
    ? await getRecitesForContent(env.ARENA_DB, 'challenge_response', response.id, false)
    : [];

  return successResponse({
    challenge,
    response: response || null,
    recites: challengeRecites,
    response_recites: responseRecites,
    fact_score: computeFactScore(challengeRecites),
    response_fact_score: computeFactScore(responseRecites),
    timeline: timelineResult.results || [],
    audit_chain: auditChain,
    audit_anchors: auditAnchors,
  });
});

router.get('/:id', async (request, env) => {
  const { id } = request.params;
  const challenge = await env.ARENA_DB.prepare(
    `SELECT ch.*,
      cc.name as challenger_name, cc.party as challenger_party,
      tc.name as target_name, tc.party as target_party
     FROM challenges ch
     JOIN candidates cc ON ch.challenger_candidate_id = cc.id
     JOIN candidates tc ON ch.target_candidate_id = tc.id
     WHERE ch.id = ? AND ch.is_visible = 1`
  ).bind(id).first();

  if (!challenge) return errorResponse('Challenge not found', 404);

  // Lazy expiration
  if (challenge.status === 'open' && challenge.response_deadline < new Date().toISOString()) {
    const expiredAt = new Date().toISOString();
    const result = await env.ARENA_DB.prepare(
      `UPDATE challenges SET status = 'expired', expired_at = ?, updated_at = ? WHERE id = ? AND status = 'open'`
    ).bind(expiredAt, expiredAt, id).run();

    challenge.status = 'expired';
    challenge.expired_at = expiredAt;

    if (result.meta?.changes) {
      await auditLogNow(env.ARENA_DB, {
        actorType: 'system',
        action: 'challenge.expire',
        entityType: 'challenge',
        entityId: id,
        beforeState: { status: 'open' },
        afterState: { status: 'expired', expired_at: expiredAt, response_deadline: challenge.response_deadline },
      });
    }
  }

  // Get response if exists
  const response = await env.ARENA_DB.prepare(
    `SELECT cr.*, c.name as candidate_name FROM challenge_responses cr
     JOIN candidates c ON cr.candidate_id = c.id WHERE cr.challenge_id = ?`
  ).bind(id).first();

  return successResponse({ ...challenge, response: response || null });
});

// POST /api/challenges — Issue a challenge (candidate staff)
router.post('/', async (request, env, ctx) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid request body');

  const { valid, errors, data } = validate(createChallengeSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  // Public campaign actions require an explicit staff link; platform admin is not campaign authority.
  const challengerStaffLink = await env.ARENA_DB.prepare(
    `SELECT id FROM candidate_staff_links WHERE user_id = ? AND candidate_id = ? AND is_active = 1`
  ).bind(request.user.id, data.challenger_candidate_id).first();
  if (!challengerStaffLink) return errorResponse('Not authorized for this candidate', 403);

  // Verify both candidates are in the same race
  const challenger = await env.ARENA_DB.prepare(
    `SELECT id, race_id, name, party, verification_status FROM candidates WHERE id = ? AND is_active = 1`
  ).bind(data.challenger_candidate_id).first();
  const target = await env.ARENA_DB.prepare(
    `SELECT id, race_id, name, party, verification_status FROM candidates WHERE id = ? AND is_active = 1`
  ).bind(data.target_candidate_id).first();
  const race = await env.ARENA_DB.prepare(
    `SELECT id, name, office, state, district FROM races WHERE id = ?`
  ).bind(data.race_id).first();

  if (!challenger || !target) return errorResponse('Candidate not found', 404);
  if (!race) return errorResponse('Race not found', 404);
  if (challenger.race_id !== data.race_id || target.race_id !== data.race_id) return errorResponse('Both candidates must be in the specified race');
  if (data.challenger_candidate_id === data.target_candidate_id) return errorResponse('Cannot challenge yourself');

  if (data.challenge_type === 'fact_check') {
    const duplicate = await env.ARENA_DB.prepare(
      `SELECT id FROM challenges
       WHERE race_id = ?
         AND challenger_candidate_id = ?
         AND target_candidate_id = ?
         AND challenge_type = 'fact_check'
         AND status != 'withdrawn'
         AND created_at > datetime('now', '-30 days')
         AND lower(COALESCE(claim_text, challenge_text)) = lower(?)
       LIMIT 1`
    ).bind(
      data.race_id,
      data.challenger_candidate_id,
      data.target_candidate_id,
      data.claim_text || data.challenge_text,
    ).first();
    if (duplicate) return errorResponse('A matching fact-check callout is already active for this candidate pair', 409);
  }

  // Cooldown check (24h between same challenger→target pair)
  const cooldownHours = parseInt(env.CHALLENGE_COOLDOWN_HOURS || '24');
  const cooldown = await env.ARENA_DB.prepare(
    `SELECT id FROM challenge_cooldowns
     WHERE challenger_candidate_id = ? AND target_candidate_id = ? AND race_id = ?
     AND cooldown_until > datetime('now')`
  ).bind(data.challenger_candidate_id, data.target_candidate_id, data.race_id).first();

  if (cooldown) return errorResponse(`Cooldown active: you must wait before issuing another challenge to this candidate`);

  // Rate-limit check (per challenger candidate)
  const maxDaily = parseInt(env.MAX_CHALLENGES_PER_DAY || '3');
  const maxWeekly = parseInt(env.MAX_CHALLENGES_PER_WEEK || '10');

  const [dailyCount, weeklyCount] = await Promise.all([
    env.ARENA_DB.prepare(
      `SELECT COUNT(*) as cnt FROM challenges WHERE challenger_candidate_id = ? AND created_at > datetime('now', '-1 day')`
    ).bind(data.challenger_candidate_id).first(),
    env.ARENA_DB.prepare(
      `SELECT COUNT(*) as cnt FROM challenges WHERE challenger_candidate_id = ? AND created_at > datetime('now', '-7 days')`
    ).bind(data.challenger_candidate_id).first(),
  ]);

  if (dailyCount.cnt >= maxDaily) return errorResponse(`Daily challenge limit reached (${maxDaily}/day). Try again tomorrow.`, 429);
  if (weeklyCount.cnt >= maxWeekly) return errorResponse(`Weekly challenge limit reached (${maxWeekly}/week). Try again next week.`, 429);

  // Atomic credit deduction — UPDATE first, check rows affected.
  // This prevents TOCTOU race: two concurrent requests both reading balance=1.
  const deductResult = await env.ARENA_DB.prepare(
    `UPDATE candidates SET credit_balance = credit_balance - 1 WHERE id = ? AND credit_balance > 0`
  ).bind(data.challenger_candidate_id).run();

  if (!deductResult.meta.changes || deductResult.meta.changes === 0) {
    return errorResponse('Insufficient credits. Each challenge costs 1 credit.', 402);
  }

  // Read new balance for response
  const updatedCandidate = await env.ARENA_DB.prepare(
    `SELECT credit_balance FROM candidates WHERE id = ?`
  ).bind(data.challenger_candidate_id).first();

  // Business day deadline (min 3, max 10, default 3)
  const bizDays = data.deadline_business_days || 3;
  const deadline = calculateBusinessDayDeadline(bizDays);
  const cooldownUntil = new Date(Date.now() + cooldownHours * 60 * 60 * 1000).toISOString();

  const challengeId = generateId('chal');
  const receiptSlug = challengeId;
  const cooldownId = generateId('cd');
  const creditTxId = generateId('ctx');
  const initialRecites = data.initial_recites || [];

  const challengeBatch = [
    env.ARENA_DB.prepare(
      `INSERT INTO challenges
       (id, race_id, challenger_candidate_id, target_candidate_id, created_by, challenge_text, claim_text,
        dispute_summary, requested_response, media_url, challenge_type, deadline_business_days, response_deadline, public_receipt_slug)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      challengeId,
      data.race_id,
      data.challenger_candidate_id,
      data.target_candidate_id,
      request.user.id,
      data.challenge_text,
      data.claim_text || null,
      data.dispute_summary || null,
      data.requested_response || null,
      data.media_url || null,
      data.challenge_type,
      bizDays,
      deadline,
      receiptSlug,
    ),
    env.ARENA_DB.prepare(
      `INSERT INTO challenge_cooldowns (id, challenger_candidate_id, target_candidate_id, race_id, cooldown_until) VALUES (?, ?, ?, ?, ?)`
    ).bind(cooldownId, data.challenger_candidate_id, data.target_candidate_id, data.race_id, cooldownUntil),
    // Log credit transaction
    env.ARENA_DB.prepare(
      `INSERT INTO credit_transactions (id, candidate_id, amount, transaction_type, description, reference_id) VALUES (?, ?, -1, 'deduction', 'Challenge issued', ?)`
    ).bind(creditTxId, data.challenger_candidate_id, challengeId),
  ];

  for (const recite of initialRecites) {
    challengeBatch.push(
      env.ARENA_DB.prepare(
        `INSERT INTO recites
         (id, content_type, content_id, user_id, url, title, publisher, source_type, stance, claim_text, quote,
          source_published_at, accessed_at, archive_url, evidence_media_url)
         VALUES (?, 'challenge', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        generateId('rec'),
        challengeId,
        request.user.id,
        recite.url,
        recite.title,
        recite.publisher || null,
        recite.source_type,
        recite.stance,
        recite.claim_text || data.claim_text || null,
        recite.quote || null,
        recite.source_published_at || null,
        recite.accessed_at || new Date().toISOString(),
        recite.archive_url || null,
        recite.evidence_media_url || null,
      )
    );
  }

  await env.ARENA_DB.batch(challengeBatch);

  const targetStaff = await env.ARENA_DB.prepare(
    `SELECT DISTINCT u.id as user_id, u.email, u.display_name
     FROM candidate_staff_links csl
     JOIN users u ON u.id = csl.user_id
     WHERE csl.candidate_id = ?
       AND csl.is_active = 1
       AND u.is_active = 1`
  ).bind(data.target_candidate_id).all();

  const targetStaffRows = targetStaff.results || [];
  const targetStaffIds = targetStaffRows.map(row => row.user_id).filter(Boolean);
  if (targetStaffIds.length > 0) {
    const notifBody = data.claim_text || data.challenge_text;
    const directNotifications = targetStaffRows.map(row => env.ARENA_DB.prepare(
      `INSERT INTO notifications (id, user_id, notification_type, title, body, link_url)
       VALUES (?, ?, 'challenge_tagged', ?, ?, ?)`
    ).bind(
      generateId('notif'),
      row.user_id,
      'Your campaign was tagged in a public callout',
      notifBody.length > 180 ? `${notifBody.slice(0, 180)}...` : notifBody,
      `/challenge/${receiptSlug}`,
    ));
    await env.ARENA_DB.batch(directNotifications);
  }

  // Create notifications for subscribers
  const subs = await env.ARENA_DB.prepare(
    `SELECT * FROM notification_subscriptions
     WHERE ((subscription_type = 'race' AND target_id = ?) OR (subscription_type = 'candidate' AND target_id = ?))
     AND is_active = 1
     LIMIT 500`
  ).bind(data.race_id, data.target_candidate_id).all();

  if (subs.results && subs.results.length > 0) {
    const notifBatch = subs.results.map(sub => {
      const notifId = generateId('notif');
      const bodyText = data.challenge_text.length > 100 ? data.challenge_text.substring(0, 100) + '...' : data.challenge_text;
      return env.ARENA_DB.prepare(
        `INSERT INTO notifications (id, user_id, subscription_id, notification_type, title, body, link_url) VALUES (?, ?, ?, 'challenge_issued', ?, ?, ?)`
      ).bind(notifId, sub.user_id, sub.id, 'New Challenge Issued', bodyText, `/challenge/${receiptSlug}`);
    });
    // Chunk into batches of 50 so large subscriber lists are never dropped
    for (let i = 0; i < notifBatch.length; i += 50) {
      await env.ARENA_DB.batch(notifBatch.slice(i, i + 50));
    }
  }

  const emailSubscribers = isTransactionalEmailConfigured(env)
    ? await env.ARENA_DB.prepare(
      `SELECT ns.id, ns.user_id, ns.channel, u.email, u.display_name
       FROM notification_subscriptions ns
       JOIN users u ON u.id = ns.user_id
       WHERE ((ns.subscription_type = 'race' AND ns.target_id = ?) OR (ns.subscription_type = 'candidate' AND ns.target_id = ?))
         AND ns.is_active = 1
         AND ns.channel IN ('email','both')
         AND u.is_active = 1
       LIMIT 500`
    ).bind(data.race_id, data.target_candidate_id).all()
    : { results: [] };

  enqueueChallengeNoticeEmails({
    request,
    env,
    ctx,
    challenge: {
      id: challengeId,
      race_id: data.race_id,
      target_candidate_id: data.target_candidate_id,
      public_receipt_slug: receiptSlug,
      response_deadline: deadline,
      challenge_text: data.challenge_text,
      claim_text: data.claim_text || null,
    },
    race,
    challenger,
    target,
    directStaff: targetStaffRows,
    subscriberRows: emailSubscribers.results || [],
  });

  await auditLogNow(env.ARENA_DB, {
    actorId: request.user.id,
    action: 'challenge.issue',
    entityType: 'challenge',
    entityId: challengeId,
    afterState: {
      status: 'open',
      challenger: data.challenger_candidate_id,
      target: data.target_candidate_id,
      deadline,
      public_receipt_slug: receiptSlug,
      initial_recites: initialRecites.length,
    },
    ipAddress: getClientIP(request),
  });

  return successResponse({
    id: challengeId,
    status: 'open',
    public_receipt_slug: receiptSlug,
    response_deadline: deadline,
    deadline_business_days: bizDays,
    media_url: data.media_url || null,
    initial_recites: initialRecites.length,
    credits_remaining: updatedCandidate?.credit_balance ?? 0,
    rate_limit: {
      daily: { used: dailyCount.cnt + 1, max: maxDaily },
      weekly: { used: weeklyCount.cnt + 1, max: maxWeekly },
    },
  });
});

// POST /api/challenges/:id/respond — Target candidate responds
router.post('/:id/respond', async (request, env, ctx) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const { id } = request.params;
  const body = await parseBody(request);
  const { valid, errors, data } = validate(respondToChallengeSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  const challenge = await env.ARENA_DB.prepare(`SELECT * FROM challenges WHERE id = ?`).bind(id).first();
  if (!challenge) return errorResponse('Challenge not found', 404);
  if (challenge.status !== 'open') return errorResponse('Challenge is not open for response');

  // Check deadline
  if (new Date(challenge.response_deadline) <= new Date()) {
    const expiredAt = new Date().toISOString();
    const result = await env.ARENA_DB.prepare(
      `UPDATE challenges SET status = 'expired', expired_at = ?, updated_at = ? WHERE id = ? AND status = 'open'`
    ).bind(expiredAt, expiredAt, id).run();
    if (result.meta?.changes) {
      await auditLogNow(env.ARENA_DB, {
        actorType: 'system',
        action: 'challenge.expire',
        entityType: 'challenge',
        entityId: id,
        beforeState: { status: 'open' },
        afterState: { status: 'expired', expired_at: expiredAt, response_deadline: challenge.response_deadline },
      });
    }
    return errorResponse('Challenge has expired');
  }

  const targetStaffLink = await env.ARENA_DB.prepare(
    `SELECT id FROM candidate_staff_links WHERE user_id = ? AND candidate_id = ? AND is_active = 1`
  ).bind(request.user.id, challenge.target_candidate_id).first();
  if (!targetStaffLink) return errorResponse('Not authorized for the target candidate', 403);

  const responseId = generateId('resp');
  await env.ARENA_DB.batch([
    env.ARENA_DB.prepare(
      `INSERT INTO challenge_responses (id, challenge_id, candidate_id, created_by, response_text, media_url) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(responseId, id, challenge.target_candidate_id, request.user.id, data.response_text, data.media_url || null),
    env.ARENA_DB.prepare(
      `UPDATE challenges SET status = 'responded', responded_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
    ).bind(id),
  ]);

  await auditLogNow(env.ARENA_DB, {
    actorId: request.user.id,
    action: 'challenge.respond',
    entityType: 'challenge',
    entityId: id,
    beforeState: { status: 'open' },
    afterState: { status: 'responded' },
    ipAddress: getClientIP(request),
  });

  return successResponse({ challenge_id: id, response_id: responseId, status: 'responded' });
});

// POST /api/challenges/:id/refuse — Target explicitly refuses
router.post('/:id/refuse', async (request, env, ctx) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const { id } = request.params;
  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid request body');

  const { valid, errors, data } = validate(refuseChallengeSchema, body);
  if (!valid) return errorResponse(errors.join('; '));
  const refusalReason = data.refusal_reason || null;

  const challenge = await env.ARENA_DB.prepare(`SELECT * FROM challenges WHERE id = ?`).bind(id).first();
  if (!challenge) return errorResponse('Challenge not found', 404);
  if (challenge.status !== 'open') return errorResponse('Challenge is not open');

  const targetStaffLink = await env.ARENA_DB.prepare(
    `SELECT id FROM candidate_staff_links WHERE user_id = ? AND candidate_id = ? AND is_active = 1`
  ).bind(request.user.id, challenge.target_candidate_id).first();
  if (!targetStaffLink) return errorResponse('Not authorized', 403);

  await env.ARENA_DB.prepare(
    `UPDATE challenges SET status = 'refused', refused_at = datetime('now'), refusal_reason = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(refusalReason, id).run();

  await auditLogNow(env.ARENA_DB, {
    actorId: request.user.id,
    action: 'challenge.refuse',
    entityType: 'challenge',
    entityId: id,
    beforeState: { status: 'open' },
    afterState: { status: 'refused', refusal_reason: refusalReason },
    ipAddress: getClientIP(request),
  });

  return successResponse({ id, status: 'refused' });
});

// POST /api/challenges/:id/withdraw — Challenger retracts
router.post('/:id/withdraw', async (request, env, ctx) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const { id } = request.params;
  const challenge = await env.ARENA_DB.prepare(`SELECT * FROM challenges WHERE id = ?`).bind(id).first();
  if (!challenge) return errorResponse('Challenge not found', 404);
  if (challenge.status !== 'open') return errorResponse('Can only withdraw open challenges');

  const challengerStaffLink = await env.ARENA_DB.prepare(
    `SELECT id FROM candidate_staff_links WHERE user_id = ? AND candidate_id = ? AND is_active = 1`
  ).bind(request.user.id, challenge.challenger_candidate_id).first();
  if (!challengerStaffLink) return errorResponse('Not authorized', 403);

  // Withdraw challenge + refund 1 credit atomically
  const refundTxId = generateId('ctx');
  await env.ARENA_DB.batch([
    env.ARENA_DB.prepare(
      `UPDATE challenges SET status = 'withdrawn', updated_at = datetime('now') WHERE id = ?`
    ).bind(id),
    env.ARENA_DB.prepare(
      `UPDATE candidates SET credit_balance = credit_balance + 1 WHERE id = ?`
    ).bind(challenge.challenger_candidate_id),
    env.ARENA_DB.prepare(
      `INSERT INTO credit_transactions (id, candidate_id, amount, transaction_type, description, reference_id) VALUES (?, ?, 1, 'refund', 'Challenge withdrawn', ?)`
    ).bind(refundTxId, challenge.challenger_candidate_id, id),
  ]);

  // Read updated balance for response
  const updatedCandidate = await env.ARENA_DB.prepare(
    `SELECT credit_balance FROM candidates WHERE id = ?`
  ).bind(challenge.challenger_candidate_id).first();

  await auditLogNow(env.ARENA_DB, {
    actorId: request.user.id,
    action: 'challenge.withdraw',
    entityType: 'challenge',
    entityId: id,
    afterState: { credit_refunded: true },
    ipAddress: getClientIP(request),
  });

  return successResponse({ id, status: 'withdrawn', credit_refunded: true, credits_remaining: updatedCandidate?.credit_balance ?? 0 });
});

export default router;
