/**
 * Arena — Press Credential Routes
 * Register, check status, admin review
 */

import { Router } from 'itty-router';
import { generateId } from '../db.js';
import { auditLog } from '../audit.js';
import {
  requireAuth, requireRole, successResponse, errorResponse, parseBody, getClientIP,
} from '../middleware.js';
import { validate, registerPressSchema } from '../validation.js';

const router = Router({ base: '/api/press' });

/**
 * POST /api/press/register — Submit press credentials
 */
router.post('/register', async (request, env) => {
  const authErr = await requireAuth(request, env);
  if (authErr) return authErr;

  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid JSON body');

  const { valid, errors, data } = validate(registerPressSchema, body);
  if (!valid) return errorResponse(errors.join(', '));

  // Check for existing credential
  const existing = await env.ARENA_DB.prepare(
    `SELECT id, status FROM press_credentials WHERE user_id = ?`
  ).bind(request.user.id).first();

  if (existing) {
    if (existing.status === 'approved') return errorResponse('You already have approved press credentials', 409);
    if (existing.status === 'pending') return errorResponse('You already have a pending application', 409);
    // If rejected, allow re-application by updating
    await env.ARENA_DB.prepare(
      `UPDATE press_credentials SET outlet_name = ?, outlet_type = ?, proof_url = ?, status = 'pending', reviewed_by = NULL, reviewed_at = NULL WHERE id = ?`
    ).bind(data.outlet_name, data.outlet_type, data.proof_url || null, existing.id).run();
    return successResponse({ id: existing.id, status: 'pending', reapplication: true });
  }

  const id = generateId('pc');
  await env.ARENA_DB.prepare(
    `INSERT INTO press_credentials (id, user_id, outlet_name, outlet_type, proof_url) VALUES (?, ?, ?, ?, ?)`
  ).bind(id, request.user.id, data.outlet_name, data.outlet_type, data.proof_url || null).run();

  return successResponse({ id, status: 'pending' });
});

/**
 * GET /api/press/my-status — Check own press credential status
 */
router.get('/my-status', async (request, env) => {
  const authErr = await requireAuth(request, env);
  if (authErr) return authErr;

  const cred = await env.ARENA_DB.prepare(
    `SELECT id, outlet_name, outlet_type, proof_url, status, reviewed_at, created_at FROM press_credentials WHERE user_id = ?`
  ).bind(request.user.id).first();

  return successResponse({ credential: cred || null });
});

/**
 * GET /api/press/pending — List pending press applications (admin/moderator)
 */
router.get('/pending', async (request, env) => {
  const roleCheck = requireRole('admin', 'super_admin', 'moderator');
  const err = await roleCheck(request, env);
  if (err) return err;

  const pending = await env.ARENA_DB.prepare(
    `SELECT pc.*, u.display_name, u.email FROM press_credentials pc JOIN users u ON pc.user_id = u.id WHERE pc.status = 'pending' ORDER BY pc.created_at ASC`
  ).all();

  return successResponse({ applications: pending.results });
});

/**
 * PUT /api/press/:id/review — Approve or reject (admin/moderator)
 * Body: { action: 'approve' | 'reject' }
 */
router.put('/:id/review', async (request, env, ctx) => {
  const roleCheck = requireRole('admin', 'super_admin', 'moderator');
  const err = await roleCheck(request, env);
  if (err) return err;

  const { id } = request.params;
  const body = await parseBody(request);
  if (!body || !['approve', 'reject'].includes(body.action)) {
    return errorResponse('action must be "approve" or "reject"');
  }

  const cred = await env.ARENA_DB.prepare(`SELECT id, user_id, status FROM press_credentials WHERE id = ?`).bind(id).first();
  if (!cred) return errorResponse('Credential not found', 404);

  const newStatus = body.action === 'approve' ? 'approved' : 'rejected';
  await env.ARENA_DB.prepare(
    `UPDATE press_credentials SET status = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`
  ).bind(newStatus, request.user.id, id).run();

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: `press.${body.action}`,
    entityType: 'press_credentials',
    entityId: id,
    beforeState: { status: cred.status },
    afterState: { status: newStatus },
    ipAddress: getClientIP(request),
  });

  return successResponse({ id, status: newStatus });
});

// 404
router.all('*', () => errorResponse('Press endpoint not found', 404));

export default router;
