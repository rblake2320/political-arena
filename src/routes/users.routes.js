/**
 * Arena — User Profile Routes
 */

import { Router } from 'itty-router';
import { requireAuth, errorResponse, successResponse, parseBody, getClientIP } from '../middleware.js';
import { validate, updateProfileSchema } from '../validation.js';
import { auditLog } from '../audit.js';

const router = Router({ base: '/api/users' });

// GET /api/users/me — Current user profile
router.get('/me', async (request, env) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  // Get staff links
  const staffLinks = await env.ARENA_DB.prepare(
    `SELECT csl.*, c.name as candidate_name, c.party as candidate_party, c.race_id
     FROM candidate_staff_links csl
     JOIN candidates c ON csl.candidate_id = c.id
     WHERE csl.user_id = ? AND csl.is_active = 1`
  ).bind(request.user.id).all();

  return successResponse({
    ...request.user,
    staff_links: staffLinks.results || [],
  });
});

// PUT /api/users/me — Update profile
router.put('/me', async (request, env, ctx) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const body = await parseBody(request);
  const { valid, errors, data } = validate(updateProfileSchema, body);
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
  values.push(request.user.id);

  await env.ARENA_DB.prepare(
    `UPDATE users SET ${fields.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: 'user.update_profile',
    entityType: 'user',
    entityId: request.user.id,
    afterState: data,
    ipAddress: getClientIP(request),
  });

  return successResponse({ updated: true });
});

// GET /api/users/:id/public — Public profile
router.get('/:id/public', async (request, env) => {
  const { id } = request.params;
  const user = await env.ARENA_DB.prepare(
    `SELECT id, username, display_name, role, verification_status, party_affiliation, jurisdiction_state, created_at FROM users WHERE id = ? AND is_active = 1`
  ).bind(id).first();

  if (!user) return errorResponse('User not found', 404);
  return successResponse({ user });
});

export default router;
