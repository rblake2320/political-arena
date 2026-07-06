/**
 * Arena — Candidate Routes
 * CRUD for candidates, staff links, verification
 */

import { Router } from 'itty-router';
import { generateId } from '../db.js';
import { auditLog } from '../audit.js';
import { requireAuth, requireRole, errorResponse, successResponse, parseBody, getClientIP } from '../middleware.js';
import { validate, createCandidateSchema, updateCandidateSchema, verifyCandidateSchema, addCandidateStaffSchema } from '../validation.js';

const router = Router({ base: '/api/candidates' });

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

// GET /api/candidates/races/:raceId — Public
router.get('/races/:raceId', async (request, env) => {
  const { raceId } = request.params;
  const result = await env.ARENA_DB.prepare(
    `SELECT * FROM candidates WHERE race_id = ? AND is_active = 1 ORDER BY name`
  ).bind(raceId).all();

  const candidates = (result.results || []).map(c => ({
    ...c,
    issue_positions: c.issue_positions ? JSON.parse(c.issue_positions) : [],
  }));

  return successResponse({ candidates });
});

// GET /api/candidates/pending — List pending candidate profile applications (admin/moderator)
router.get('/pending', async (request, env) => {
  const authError = await requireRole('admin', 'super_admin', 'moderator')(request, env);
  if (authError) return authError;

  const result = await env.ARENA_DB.prepare(
    `SELECT
       c.id,
       c.race_id,
       c.user_id,
       c.name,
       c.party,
       c.biography,
       c.issue_positions,
       c.photo_url,
       c.website_url,
       c.verification_status,
       c.created_at,
       c.updated_at,
       r.name as race_name,
       r.state as race_state,
       r.office as race_office,
       r.district as race_district,
       u.display_name as applicant_name,
       u.email as applicant_email
     FROM candidates c
     JOIN races r ON r.id = c.race_id
     JOIN users u ON u.id = c.user_id
     WHERE c.verification_status = 'pending'
       AND c.user_id IS NOT NULL
       AND c.is_active = 1
     ORDER BY c.created_at DESC, c.id DESC`
  ).all();

  const candidates = (result.results || []).map(candidate => ({
    ...candidate,
    issue_positions: candidate.issue_positions ? JSON.parse(candidate.issue_positions) : [],
  }));

  return successResponse({ candidates });
});

// GET /api/candidates/:id/public-profile — Public trust ledger profile
router.get('/:id/public-profile', async (request, env) => {
  const { id } = request.params;
  const candidate = await env.ARENA_DB.prepare(
    `SELECT c.*, r.name as race_name, r.state as race_state, r.office as race_office, r.district as race_district
     FROM candidates c JOIN races r ON c.race_id = r.id
     WHERE c.id = ? AND c.is_active = 1`
  ).bind(id).first();

  if (!candidate) return errorResponse('Candidate not found', 404);
  candidate.issue_positions = candidate.issue_positions ? JSON.parse(candidate.issue_positions) : [];

  const [
    targeted,
    issued,
    ads,
    rebuttals,
    statements,
    verifiedRecites,
    recentChallenges,
    recentAds,
    recentStatements,
  ] = await Promise.all([
    env.ARENA_DB.prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN notice_status != 'unserved' THEN 1 ELSE 0 END) as accountable_total,
         SUM(CASE WHEN status = 'responded' THEN 1 ELSE 0 END) as responded,
         SUM(CASE WHEN status = 'expired' AND notice_status != 'unserved' THEN 1 ELSE 0 END) as expired,
         SUM(CASE WHEN status = 'refused' THEN 1 ELSE 0 END) as refused,
         SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open
       FROM challenges WHERE target_candidate_id = ? AND is_visible = 1`
    ).bind(id).first(),
    env.ARENA_DB.prepare(
      `SELECT COUNT(*) as total FROM challenges WHERE challenger_candidate_id = ? AND is_visible = 1`
    ).bind(id).first(),
    env.ARENA_DB.prepare(
      `SELECT COUNT(*) as total FROM ad_flights WHERE candidate_id = ? AND status IN ('approved','active','completed')`
    ).bind(id).first(),
    env.ARENA_DB.prepare(
      `SELECT COUNT(*) as total FROM rebuttal_ads WHERE candidate_id = ? AND status IN ('approved','active','completed')`
    ).bind(id).first(),
    env.ARENA_DB.prepare(
      `SELECT
         COUNT(*) as total,
         AVG(evasion_score) as avg_evasion_score,
         SUM(CASE WHEN answer_status = 'dodged' THEN 1 ELSE 0 END) as dodged,
         SUM(CASE WHEN truth_status IN ('disputed','false') THEN 1 ELSE 0 END) as disputed_or_false,
         SUM(CASE WHEN truth_status = 'supported' THEN 1 ELSE 0 END) as supported
       FROM public_statements WHERE candidate_id = ? AND is_public = 1`
    ).bind(id).first(),
    env.ARENA_DB.prepare(
      `SELECT COUNT(*) as total
       FROM recites
       WHERE status = 'verified'
         AND (
           (content_type = 'challenge' AND content_id IN (
             SELECT id FROM challenges WHERE challenger_candidate_id = ? OR target_candidate_id = ?
           ))
           OR (content_type = 'challenge_response' AND content_id IN (
             SELECT cr.id FROM challenge_responses cr
             JOIN challenges ch ON cr.challenge_id = ch.id
             WHERE cr.candidate_id = ? OR ch.challenger_candidate_id = ? OR ch.target_candidate_id = ?
           ))
           OR (content_type = 'ad' AND content_id IN (
             SELECT id FROM ad_flights WHERE candidate_id = ?
           ))
           OR (content_type = 'rebuttal' AND content_id IN (
             SELECT id FROM rebuttal_ads WHERE candidate_id = ?
           ))
         )`
    ).bind(id, id, id, id, id, id, id).first(),
    env.ARENA_DB.prepare(
      `SELECT id, challenge_text, claim_text, challenge_type, status, response_deadline, public_receipt_slug, created_at
       FROM challenges
       WHERE (challenger_candidate_id = ? OR target_candidate_id = ?) AND is_visible = 1
       ORDER BY created_at DESC LIMIT 12`
    ).bind(id, id).all(),
    env.ARENA_DB.prepare(
      `SELECT id, title, status, source_type, created_at
       FROM ad_flights
       WHERE candidate_id = ? AND status IN ('approved','active','completed')
       ORDER BY created_at DESC LIMIT 8`
    ).bind(id).all(),
    env.ARENA_DB.prepare(
      `SELECT id, statement_text, topic, source_type, source_url, source_title, quote_start_seconds,
              truth_status, answer_status, evasion_score, confidence_score, statement_at, created_at
       FROM public_statements
       WHERE candidate_id = ? AND is_public = 1
       ORDER BY COALESCE(statement_at, created_at) DESC LIMIT 10`
    ).bind(id).all(),
  ]);

  const targetedTotal = targeted.total || 0;
  const accountableTotal = targeted.accountable_total || 0;
  const responseRate = accountableTotal > 0 ? (targeted.responded || 0) / accountableTotal : 1;
  const expiredRate = accountableTotal > 0 ? (targeted.expired || 0) / accountableTotal : 0;
  const refusedRate = accountableTotal > 0 ? (targeted.refused || 0) / accountableTotal : 0;
  const avgEvasion = Number.isFinite(statements.avg_evasion_score) ? Number(statements.avg_evasion_score) : 0;
  const trustScore = clampScore(
    55
    + (responseRate * 20)
    - (expiredRate * 25)
    - (refusedRate * 10)
    - (avgEvasion * 0.18)
    - ((statements.disputed_or_false || 0) * 3)
    + Math.min(verifiedRecites.total || 0, 10) * 1.5
    + Math.min(statements.supported || 0, 5) * 2
  );

  const timeline = [
    ...(recentChallenges.results || []).map(item => ({
      type: 'challenge',
      id: item.id,
      title: item.claim_text || item.challenge_text,
      status: item.status,
      created_at: item.created_at,
      href: `/challenge/${item.public_receipt_slug || item.id}`,
    })),
    ...(recentAds.results || []).map(item => ({
      type: item.source_type === 'external' ? 'outside_ad_response' : 'ad',
      id: item.id,
      title: item.title || 'Campaign ad',
      status: item.status,
      created_at: item.created_at,
      href: `/race/${candidate.race_id}`,
    })),
    ...(recentStatements.results || []).map(item => ({
      type: 'statement',
      id: item.id,
      title: item.statement_text,
      status: item.truth_status,
      created_at: item.statement_at || item.created_at,
      href: item.source_url,
    })),
  ].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).slice(0, 20);

  return successResponse({
    candidate,
    trust: {
      score: trustScore,
      response_rate: Number((responseRate * 100).toFixed(1)),
      avg_evasion_score: Math.round(avgEvasion || 0),
      verified_recites: verifiedRecites.total || 0,
    },
    stats: {
      challenges_targeted: targetedTotal,
      challenges_accountable: accountableTotal,
      challenges_responded: targeted.responded || 0,
      challenges_expired: targeted.expired || 0,
      challenges_refused: targeted.refused || 0,
      challenges_open: targeted.open || 0,
      challenges_issued: issued.total || 0,
      ads: ads.total || 0,
      rebuttals: rebuttals.total || 0,
      statements: statements.total || 0,
      statements_dodged: statements.dodged || 0,
      statements_disputed_or_false: statements.disputed_or_false || 0,
      statements_supported: statements.supported || 0,
    },
    recent_statements: recentStatements.results || [],
    timeline,
  });
});

// GET /api/candidates/:id — Public
router.get('/:id', async (request, env) => {
  const { id } = request.params;
  const candidate = await env.ARENA_DB.prepare(
    `SELECT c.*, r.name as race_name, r.state as race_state, r.office as race_office
     FROM candidates c JOIN races r ON c.race_id = r.id WHERE c.id = ?`
  ).bind(id).first();

  if (!candidate) return errorResponse('Candidate not found', 404);

  candidate.issue_positions = candidate.issue_positions ? JSON.parse(candidate.issue_positions) : [];

  return successResponse({ candidate });
});

// POST /api/candidates — Register as candidate (auth required)
router.post('/', async (request, env, ctx) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid request body');

  const { valid, errors, data } = validate(createCandidateSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  // Verify race exists
  const race = await env.ARENA_DB.prepare(`SELECT id FROM races WHERE id = ? AND status IN ('upcoming','active')`).bind(data.race_id).first();
  if (!race) return errorResponse('Race not found or not accepting candidates', 404);

  // Check if user already has a candidate in this race
  const existing = await env.ARENA_DB.prepare(
    `SELECT id FROM candidates WHERE race_id = ? AND user_id = ? AND is_active = 1`
  ).bind(data.race_id, request.user.id).first();
  if (existing) return errorResponse('You already have a candidate registered in this race', 409);

  const candidateId = generateId('cand');
  await env.ARENA_DB.prepare(
    `INSERT INTO candidates (id, race_id, user_id, name, party, biography, issue_positions, website_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    candidateId, data.race_id, request.user.id, data.name, data.party,
    data.biography || null,
    data.issue_positions ? JSON.stringify(data.issue_positions) : null,
    data.website_url || null,
  ).run();

  // Auto-create primary staff link
  const linkId = generateId('sl');
  await env.ARENA_DB.prepare(
    `INSERT INTO candidate_staff_links (id, user_id, candidate_id, role, granted_by) VALUES (?, ?, ?, 'primary', ?)`
  ).bind(linkId, request.user.id, candidateId, request.user.id).run();

  // Update user role to candidate_staff if they're just a voter
  if (request.user.role === 'voter') {
    await env.ARENA_DB.prepare(
      `UPDATE users SET role = 'candidate_staff', updated_at = datetime('now') WHERE id = ?`
    ).bind(request.user.id).run();
  }

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: 'candidate.register',
    entityType: 'candidate',
    entityId: candidateId,
    afterState: data,
    ipAddress: getClientIP(request),
  });

  return successResponse({ id: candidateId, ...data, verification_status: 'pending' });
});

// PUT /api/candidates/:id — Update candidate (staff only)
router.put('/:id', async (request, env, ctx) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const { id } = request.params;

  const link = await env.ARENA_DB.prepare(
    `SELECT id FROM candidate_staff_links WHERE user_id = ? AND candidate_id = ? AND is_active = 1`
  ).bind(request.user.id, id).first();
  if (!link) return errorResponse('Not authorized to modify this candidate', 403);

  const existing = await env.ARENA_DB.prepare(`SELECT * FROM candidates WHERE id = ?`).bind(id).first();
  if (!existing) return errorResponse('Candidate not found', 404);

  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid request body');

  const { valid, errors, data } = validate(updateCandidateSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      if (key === 'issue_positions') {
        fields.push(`${key} = ?`);
        values.push(JSON.stringify(value));
      } else {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
  }

  if (fields.length === 0) return errorResponse('No fields to update');

  fields.push(`updated_at = datetime('now')`);
  values.push(id);

  await env.ARENA_DB.prepare(
    `UPDATE candidates SET ${fields.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: 'candidate.update',
    entityType: 'candidate',
    entityId: id,
    beforeState: existing,
    afterState: data,
    ipAddress: getClientIP(request),
  });

  return successResponse({ id, ...data });
});

// POST /api/candidates/:id/verify — Admin verifies candidate
router.post('/:id/verify', async (request, env, ctx) => {
  const authError = await requireRole('admin', 'super_admin')(request, env);
  if (authError) return authError;

  const { id } = request.params;
  const body = await parseBody(request);
  const { valid, errors, data } = validate(verifyCandidateSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  const candidate = await env.ARENA_DB.prepare(`SELECT * FROM candidates WHERE id = ?`).bind(id).first();
  if (!candidate) return errorResponse('Candidate not found', 404);

  const newStatus = data.action === 'reject' ? 'rejected' : 'verified';
  await env.ARENA_DB.prepare(
    `UPDATE candidates SET verification_status = ?, verified_by = ?, verified_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
  ).bind(newStatus, request.user.id, id).run();

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: `candidate.${data.action}`,
    entityType: 'candidate',
    entityId: id,
    beforeState: { verification_status: candidate.verification_status },
    afterState: { verification_status: newStatus },
    ipAddress: getClientIP(request),
  });

  return successResponse({ id, verification_status: newStatus });
});

// POST /api/candidates/:id/staff — Add staff member
router.post('/:id/staff', async (request, env, ctx) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const { id } = request.params;

  const candidate = await env.ARENA_DB.prepare(
    `SELECT id FROM candidates WHERE id = ? AND is_active = 1`
  ).bind(id).first();
  if (!candidate) return errorResponse('Candidate not found', 404);

  // Only primary staff or admin can add staff
  const isAdmin = ['admin', 'super_admin'].includes(request.user.role);
  if (!isAdmin) {
    const link = await env.ARENA_DB.prepare(
      `SELECT role FROM candidate_staff_links WHERE user_id = ? AND candidate_id = ? AND is_active = 1 AND role = 'primary'`
    ).bind(request.user.id, id).first();
    if (!link) return errorResponse('Only the primary contact can add staff', 403);
  }

  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid request body');

  const { valid, errors, data } = validate(addCandidateStaffSchema, body);
  if (!valid) return errorResponse(errors.join('; '));
  if (data.role === 'primary' && !isAdmin) {
    return errorResponse('Only admins can grant primary staff role', 403);
  }

  // Check target user exists
  const targetUser = await env.ARENA_DB.prepare(`SELECT id FROM users WHERE id = ? AND is_active = 1`).bind(data.user_id).first();
  if (!targetUser) return errorResponse('User not found', 404);

  const linkId = generateId('sl');
  try {
    await env.ARENA_DB.prepare(
      `INSERT INTO candidate_staff_links (id, user_id, candidate_id, role, granted_by) VALUES (?, ?, ?, ?, ?)`
    ).bind(linkId, data.user_id, id, data.role, request.user.id).run();
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return errorResponse('User is already staff for this candidate', 409);
    throw e;
  }

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: 'candidate.add_staff',
    entityType: 'candidate',
    entityId: id,
    afterState: { user_id: data.user_id, role: data.role },
    ipAddress: getClientIP(request),
  });

  return successResponse({ id: linkId, user_id: data.user_id, candidate_id: id, role: data.role });
});

export default router;
