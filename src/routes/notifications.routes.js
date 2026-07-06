/**
 * Arena — Notification Routes
 * Subscribe to races/candidates/challenges, "Notify Me" system
 */

import { Router } from 'itty-router';
import { generateId } from '../db.js';
import { requireAuth, errorResponse, successResponse, parseBody, parsePagination } from '../middleware.js';
import { validate, subscribeSchema } from '../validation.js';
import { enrichSavedItems, savedTargetExists } from './saved-items.helpers.js';

const router = Router({ base: '/api/notifications' });

async function subscriptionTargetExists(env, subscriptionType, targetId) {
  return savedTargetExists(env, subscriptionType, targetId);
}

// POST /api/notifications/subscribe — Subscribe to events
router.post('/subscribe', async (request, env) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const body = await parseBody(request);
  const { valid, errors, data } = validate(subscribeSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  const targetExists = await subscriptionTargetExists(env, data.subscription_type, data.target_id);
  if (!targetExists) return errorResponse('Subscription target not found', 404);

  // Check for existing subscription
  const existing = await env.ARENA_DB.prepare(
    `SELECT id FROM notification_subscriptions WHERE user_id = ? AND subscription_type = ? AND target_id = ? AND is_active = 1`
  ).bind(request.user.id, data.subscription_type, data.target_id).first();

  if (existing) return errorResponse('Already subscribed', 409);

  const subId = generateId('nsub');
  await env.ARENA_DB.prepare(
    `INSERT INTO notification_subscriptions (id, user_id, subscription_type, target_id, notify_on, channel) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(subId, request.user.id, data.subscription_type, data.target_id, JSON.stringify(data.notify_on), data.channel).run();

  return successResponse({ id: subId, ...data });
});

// DELETE /api/notifications/subscribe/:id — Unsubscribe
router.delete('/subscribe/:id', async (request, env) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const { id } = request.params;
  await env.ARENA_DB.prepare(
    `UPDATE notification_subscriptions SET is_active = 0 WHERE id = ? AND user_id = ?`
  ).bind(id, request.user.id).run();

  return successResponse({ unsubscribed: true });
});

// GET /api/notifications/my-subscriptions — List active subscriptions
router.get('/my-subscriptions', async (request, env) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const result = await env.ARENA_DB.prepare(
    `SELECT * FROM notification_subscriptions WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC`
  ).bind(request.user.id).all();

  return successResponse({ subscriptions: result.results || [] });
});

// GET /api/notifications/watchlist — Enriched watched races/candidates/challenges
router.get('/watchlist', async (request, env) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const result = await env.ARENA_DB.prepare(
    `SELECT id, subscription_type, target_id, notify_on, channel, created_at
     FROM notification_subscriptions
     WHERE user_id = ? AND is_active = 1
     ORDER BY created_at DESC`
  ).bind(request.user.id).all();

  const { items, grouped } = await enrichSavedItems(env, result.results || [], 'subscription_type');
  return successResponse({ subscriptions: items, grouped });
});

// GET /api/notifications — List user's notifications
router.get('/', async (request, env) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const url = new URL(request.url);
  const { limit, offset } = parsePagination(url);

  const result = await env.ARENA_DB.prepare(
    `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(request.user.id, limit, offset).all();

  return successResponse({ notifications: result.results || [] });
});

// PUT /api/notifications/:id/read — Mark as read
router.put('/:id/read', async (request, env) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  await env.ARENA_DB.prepare(
    `UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`
  ).bind(request.params.id, request.user.id).run();

  return successResponse({ read: true });
});

// PUT /api/notifications/read-all — Mark all as read
router.put('/read-all', async (request, env) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  await env.ARENA_DB.prepare(
    `UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0`
  ).bind(request.user.id).run();

  return successResponse({ read_all: true });
});

// GET /api/notifications/unread-count — Badge count
router.get('/unread-count', async (request, env) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const result = await env.ARENA_DB.prepare(
    `SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0`
  ).bind(request.user.id).first();

  return successResponse({ count: result.count });
});

export default router;
