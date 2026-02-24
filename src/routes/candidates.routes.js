/**
 * Arena — Candidate Routes
 * CRUD for candidates, staff links, verification
 */

import { Router } from 'itty-router';
import { generateId } from '../db.js';
import { auditLog } from '../audit.js';
import { requireAuth, requireRole, errorResponse, successResponse, parseBody, getClientIP } from '../middleware.js';
import { validate, createCandidateSchema, updateCandidateSchema } from '../validation.js';

const router = Router({ base: '/api/candidates' });

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

  // Check staff authorization
  const isAdmin = ['admin', 'super_admin'].includes(request.user.role);
  if (!isAdmin) {
    const link = await env.ARENA_DB.prepare(
      `SELECT id FROM candidate_staff_links WHERE user_id = ? AND candidate_id = ? AND is_active = 1`
    ).bind(request.user.id, id).first();
    if (!link) return errorResponse('Not authorized to modify this candidate', 403);
  }

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
  const action = body?.action || 'verify'; // 'verify' or 'reject'

  const candidate = await env.ARENA_DB.prepare(`SELECT * FROM candidates WHERE id = ?`).bind(id).first();
  if (!candidate) return errorResponse('Candidate not found', 404);

  const newStatus = action === 'reject' ? 'rejected' : 'verified';
  await env.ARENA_DB.prepare(
    `UPDATE candidates SET verification_status = ?, verified_by = ?, verified_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
  ).bind(newStatus, request.user.id, id).run();

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: `candidate.${action}`,
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

  // Only primary staff or admin can add staff
  const isAdmin = ['admin', 'super_admin'].includes(request.user.role);
  if (!isAdmin) {
    const link = await env.ARENA_DB.prepare(
      `SELECT role FROM candidate_staff_links WHERE user_id = ? AND candidate_id = ? AND is_active = 1 AND role = 'primary'`
    ).bind(request.user.id, id).first();
    if (!link) return errorResponse('Only the primary contact can add staff', 403);
  }

  const body = await parseBody(request);
  if (!body || !body.user_id) return errorResponse('user_id required');

  // Check target user exists
  const targetUser = await env.ARENA_DB.prepare(`SELECT id FROM users WHERE id = ? AND is_active = 1`).bind(body.user_id).first();
  if (!targetUser) return errorResponse('User not found', 404);

  const linkId = generateId('sl');
  try {
    await env.ARENA_DB.prepare(
      `INSERT INTO candidate_staff_links (id, user_id, candidate_id, role, granted_by) VALUES (?, ?, ?, ?, ?)`
    ).bind(linkId, body.user_id, id, body.role || 'staff', request.user.id).run();
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return errorResponse('User is already staff for this candidate', 409);
    throw e;
  }

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: 'candidate.add_staff',
    entityType: 'candidate',
    entityId: id,
    afterState: { user_id: body.user_id, role: body.role || 'staff' },
    ipAddress: getClientIP(request),
  });

  return successResponse({ id: linkId, user_id: body.user_id, candidate_id: id, role: body.role || 'staff' });
});

export default router;
