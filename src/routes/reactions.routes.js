/**
 * Arena — Reaction Routes
 * Verified voters only — engagement gated behind verification
 */

import { Router } from 'itty-router';
import { generateId } from '../db.js';
import { requireVerifiedVoter, requireAuth, errorResponse, successResponse, parseBody } from '../middleware.js';
import { validate, createReactionSchema } from '../validation.js';

const router = Router({ base: '/api/reactions' });

// POST /api/reactions — Add reaction (verified voters only)
router.post('/', async (request, env) => {
  const authError = await requireVerifiedVoter(request, env);
  if (authError) return authError;

  const body = await parseBody(request);
  const { valid, errors, data } = validate(createReactionSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  const reactionId = generateId('rx');
  try {
    await env.ARENA_DB.prepare(
      `INSERT INTO reactions (id, user_id, content_type, content_id, reaction_type) VALUES (?, ?, ?, ?, ?)`
    ).bind(reactionId, request.user.id, data.content_type, data.content_id, data.reaction_type).run();
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return errorResponse('You already reacted this way', 409);
    throw e;
  }

  return successResponse({ id: reactionId });
});

// DELETE /api/reactions/:id — Remove reaction
router.delete('/:id', async (request, env) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const { id } = request.params;
  const reaction = await env.ARENA_DB.prepare(
    `SELECT id FROM reactions WHERE id = ? AND user_id = ?`
  ).bind(id, request.user.id).first();

  if (!reaction) return errorResponse('Reaction not found', 404);

  await env.ARENA_DB.prepare(`DELETE FROM reactions WHERE id = ?`).bind(id).run();
  return successResponse({ deleted: true });
});

// GET /api/reactions/counts — Get reaction counts for content
router.get('/counts', async (request, env) => {
  const url = new URL(request.url);
  const contentType = url.searchParams.get('content_type');
  const contentId = url.searchParams.get('content_id');

  if (!contentType || !contentId) return errorResponse('content_type and content_id required');

  const result = await env.ARENA_DB.prepare(
    `SELECT reaction_type, COUNT(*) as count FROM reactions WHERE content_type = ? AND content_id = ? GROUP BY reaction_type`
  ).bind(contentType, contentId).all();

  const counts = {};
  (result.results || []).forEach(r => { counts[r.reaction_type] = r.count; });

  return successResponse({ counts });
});

// GET /api/reactions/mine — Get current user's reactions
router.get('/mine', async (request, env) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const url = new URL(request.url);
  const contentType = url.searchParams.get('content_type');
  const contentId = url.searchParams.get('content_id');

  let sql = `SELECT * FROM reactions WHERE user_id = ?`;
  const binds = [request.user.id];

  if (contentType) { sql += ` AND content_type = ?`; binds.push(contentType); }
  if (contentId) { sql += ` AND content_id = ?`; binds.push(contentId); }

  const result = await env.ARENA_DB.prepare(sql).bind(...binds).all();
  return successResponse({ reactions: result.results || [] });
});

export default router;
