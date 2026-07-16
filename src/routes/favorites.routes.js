/**
 * Arena — Favorites Routes
 * Saved races/candidates/challenges for quick return access.
 */

import { Router } from 'itty-router';
import { generateId } from '../db.js';
import { requireAuth, errorResponse, successResponse, parseBody } from '../middleware.js';
import { validate, favoriteSchema } from '../validation.js';
import { enrichSavedItems, savedTargetExists, SAVED_ITEMS_LIST_LIMIT } from './saved-items.helpers.js';

const router = Router({ base: '/api/favorites' });

// GET /api/favorites — List current user's saved items with target summaries
router.get('/', async (request, env) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const result = await env.ARENA_DB.prepare(
    `SELECT id, favorite_type, target_id, created_at
     FROM user_favorites
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`
  ).bind(request.user.id, SAVED_ITEMS_LIST_LIMIT).all();

  const { items, grouped } = await enrichSavedItems(env, result.results || [], 'favorite_type');
  return successResponse({ favorites: items, grouped });
});

// POST /api/favorites — Save a race/candidate/challenge
router.post('/', async (request, env) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const body = await parseBody(request);
  const { valid, errors, data } = validate(favoriteSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  const targetExists = await savedTargetExists(env, data.favorite_type, data.target_id);
  if (!targetExists) return errorResponse('Favorite target not found', 404);

  const favoriteId = generateId('fav');
  try {
    await env.ARENA_DB.prepare(
      `INSERT INTO user_favorites (id, user_id, favorite_type, target_id)
       VALUES (?, ?, ?, ?)`
    ).bind(favoriteId, request.user.id, data.favorite_type, data.target_id).run();
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return errorResponse('Already favorited', 409);
    throw err;
  }

  return successResponse({
    id: favoriteId,
    favorite_type: data.favorite_type,
    target_id: data.target_id,
  });
});

// DELETE /api/favorites/:id — Remove a saved item by favorite id
router.delete('/:id', async (request, env) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const result = await env.ARENA_DB.prepare(
    `DELETE FROM user_favorites WHERE id = ? AND user_id = ?`
  ).bind(request.params.id, request.user.id).run();

  return successResponse({ removed: (result.meta?.changes || 0) > 0 });
});

export default router;
