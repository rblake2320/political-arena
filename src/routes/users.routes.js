/**
 * Arena — User Profile Routes
 */

import { Router } from 'itty-router';
import { requireAuth, errorResponse, successResponse, parseBody, getClientIP } from '../middleware.js';
import { validate, updateProfileSchema, deleteAccountSchema } from '../validation.js';
import { verifyPassword } from '../auth.js';
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

// GET /api/users/me/export — the user's data, as JSON (privacy-law data access)
router.get('/me/export', async (request, env) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;
  const uid = request.user.id;

  const [profile, questions, votes, recites, corrections, reactions, priorities, subscriptions, notifications] = await Promise.all([
    env.ARENA_DB.prepare(`SELECT id, email, username, display_name, role, party_affiliation, jurisdiction_state, jurisdiction_district, verification_status, created_at, last_login FROM users WHERE id = ?`).bind(uid).first(),
    env.ARENA_DB.prepare(`SELECT id, race_id, question_text, vote_count, status, created_at FROM questions WHERE user_id = ?`).bind(uid).all(),
    env.ARENA_DB.prepare(`SELECT question_id, created_at FROM question_votes WHERE user_id = ?`).bind(uid).all(),
    env.ARENA_DB.prepare(`SELECT id, content_type, content_id, url, title, stance, status, created_at FROM recites WHERE user_id = ?`).bind(uid).all(),
    env.ARENA_DB.prepare(`SELECT id, content_type, content_id, requested_change, status, created_at FROM correction_requests WHERE requester_id = ?`).bind(uid).all(),
    env.ARENA_DB.prepare(`SELECT id, content_type, content_id, reaction_type, created_at FROM reactions WHERE user_id = ?`).bind(uid).all(),
    env.ARENA_DB.prepare(`SELECT issue_category_id, priority_rank, race_id, created_at FROM voter_issue_priorities WHERE user_id = ?`).bind(uid).all().catch(() => ({ results: [] })),
    env.ARENA_DB.prepare(`SELECT id, subscription_type, target_id, channel, created_at FROM notification_subscriptions WHERE user_id = ?`).bind(uid).all(),
    env.ARENA_DB.prepare(`SELECT id, notification_type, title, body, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 500`).bind(uid).all(),
  ]);

  return successResponse({
    exported_at: new Date().toISOString(),
    profile,
    questions: questions.results || [],
    question_votes: votes.results || [],
    recites: recites.results || [],
    correction_requests: corrections.results || [],
    reactions: reactions.results || [],
    issue_priorities: priorities.results || [],
    subscriptions: subscriptions.results || [],
    notifications: notifications.results || [],
  });
});

// POST /api/users/me/delete — account deletion (privacy-law erasure).
// PII is anonymized in place; content rows and the hash-chained audit log
// survive with a tombstoned author, so the public record stays intact.
router.post('/me/delete', async (request, env, ctx) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const body = await parseBody(request);
  const { valid, errors, data } = validate(deleteAccountSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  const row = await env.ARENA_DB.prepare(`SELECT password_hash, role FROM users WHERE id = ?`).bind(request.user.id).first();
  const ok = await verifyPassword(data.password, row.password_hash);
  if (!ok) return errorResponse('Password is incorrect', 403);
  if (['admin', 'super_admin'].includes(row.role)) {
    return errorResponse('Admin accounts must transfer the role before deletion', 400);
  }

  const uid = request.user.id;
  const tombstone = uid.replace(/[^a-z0-9]/gi, '').slice(-12).toLowerCase();
  await env.ARENA_DB.batch([
    env.ARENA_DB.prepare(
      `UPDATE users SET
         email = ?, username = ?, display_name = 'Deleted account',
         password_hash = 'deleted:' || lower(hex(randomblob(16))),
         party_affiliation = NULL, jurisdiction_state = NULL, jurisdiction_district = NULL,
         verification_token = NULL, password_reset_token_hash = NULL, password_reset_expires_at = NULL,
         is_active = 0, updated_at = datetime('now')
       WHERE id = ?`
    ).bind(`deleted-${tombstone}@deleted.invalid`, `deleted_${tombstone}`, uid),
    env.ARENA_DB.prepare(`UPDATE sessions SET is_active = 0 WHERE user_id = ?`).bind(uid),
    env.ARENA_DB.prepare(`UPDATE candidate_staff_links SET is_active = 0 WHERE user_id = ?`).bind(uid),
    env.ARENA_DB.prepare(`DELETE FROM notification_subscriptions WHERE user_id = ?`).bind(uid),
    env.ARENA_DB.prepare(`DELETE FROM voter_issue_priorities WHERE user_id = ?`).bind(uid),
  ]);

  auditLog(env.ARENA_DB, ctx, {
    actorId: uid,
    action: 'user.delete_account',
    entityType: 'user',
    entityId: uid,
    afterState: { anonymized: true },
    ipAddress: getClientIP(request),
  });

  return successResponse({ message: 'Account deleted. Personal data has been anonymized; public-record contributions remain attributed to "Deleted account".' });
});

export default router;
