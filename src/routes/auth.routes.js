/**
 * Arena — Auth Routes
 * POST /api/auth/register, login, verify-email, logout, forgot-password, reset-password
 */

import { Router } from 'itty-router';
import { hashPassword, verifyPassword, createJWT, hashToken, generateVerificationToken } from '../auth.js';
import { generateId } from '../db.js';
import { auditLog } from '../audit.js';
import { json, errorResponse, successResponse, parseBody, getClientIP } from '../middleware.js';
import { validate, registerSchema, loginSchema } from '../validation.js';
import { authenticate } from '../auth.js';

const router = Router({ base: '/api/auth' });

// POST /api/auth/register
router.post('/register', async (request, env, ctx) => {
  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid request body');

  const { valid, errors, data } = validate(registerSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  // Check if email or username already exists
  const existing = await env.ARENA_DB.prepare(
    `SELECT id FROM users WHERE email = ? OR username = ?`
  ).bind(data.email.toLowerCase(), data.username.toLowerCase()).first();

  if (existing) return errorResponse('Email or username already taken', 409);

  const userId = generateId('usr');
  const passwordHash = await hashPassword(data.password);
  const verificationToken = generateVerificationToken();

  await env.ARENA_DB.prepare(
    `INSERT INTO users (id, email, username, display_name, password_hash, verification_token, party_affiliation, jurisdiction_state, jurisdiction_district)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    userId,
    data.email.toLowerCase(),
    data.username.toLowerCase(),
    data.display_name,
    passwordHash,
    verificationToken,
    data.party_affiliation || null,
    data.jurisdiction_state || null,
    data.jurisdiction_district || null,
  ).run();

  auditLog(env.ARENA_DB, ctx, {
    actorId: userId,
    action: 'user.register',
    entityType: 'user',
    entityId: userId,
    afterState: { email: data.email, username: data.username },
    ipAddress: getClientIP(request),
  });

  // Create session and JWT
  const sessionId = generateId('ses');
  const token = await createJWT({ userId, sessionId, role: 'voter' }, env);
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await env.ARENA_DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, ip_address, user_agent, expires_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(sessionId, userId, tokenHash, getClientIP(request), request.headers.get('User-Agent'), expiresAt).run();

  return successResponse({
    token,
    user: {
      id: userId,
      email: data.email.toLowerCase(),
      username: data.username.toLowerCase(),
      display_name: data.display_name,
      role: 'voter',
      email_verified: false,
      verification_status: 'unverified',
    },
  });
});

// POST /api/auth/login
router.post('/login', async (request, env, ctx) => {
  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid request body');

  const { valid, errors, data } = validate(loginSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  const user = await env.ARENA_DB.prepare(
    `SELECT id, email, username, display_name, password_hash, role, email_verified, verification_status, party_affiliation, jurisdiction_state, jurisdiction_district, is_active FROM users WHERE email = ?`
  ).bind(data.email.toLowerCase()).first();

  if (!user || !user.is_active) return errorResponse('Invalid email or password', 401);

  const passwordValid = await verifyPassword(data.password, user.password_hash);
  if (!passwordValid) return errorResponse('Invalid email or password', 401);

  // Create session
  const sessionId = generateId('ses');
  const token = await createJWT({ userId: user.id, sessionId, role: user.role }, env);
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await env.ARENA_DB.batch([
    env.ARENA_DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, ip_address, user_agent, expires_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(sessionId, user.id, tokenHash, getClientIP(request), request.headers.get('User-Agent'), expiresAt),
    env.ARENA_DB.prepare(
      `UPDATE users SET last_login = datetime('now') WHERE id = ?`
    ).bind(user.id),
  ]);

  auditLog(env.ARENA_DB, ctx, {
    actorId: user.id,
    action: 'user.login',
    entityType: 'user',
    entityId: user.id,
    ipAddress: getClientIP(request),
  });

  return successResponse({
    token,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
      email_verified: !!user.email_verified,
      verification_status: user.verification_status,
      party_affiliation: user.party_affiliation,
      jurisdiction_state: user.jurisdiction_state,
      jurisdiction_district: user.jurisdiction_district,
    },
  });
});

// POST /api/auth/logout
router.post('/logout', async (request, env, ctx) => {
  const user = await authenticate(request, env);
  if (!user) return errorResponse('Not authenticated', 401);

  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (token) {
    const tokenH = await hashToken(token);
    await env.ARENA_DB.prepare(
      `UPDATE sessions SET is_active = 0 WHERE token_hash = ?`
    ).bind(tokenH).run();
  }

  auditLog(env.ARENA_DB, ctx, {
    actorId: user.id,
    action: 'user.logout',
    entityType: 'user',
    entityId: user.id,
    ipAddress: getClientIP(request),
  });

  return successResponse({ message: 'Logged out successfully' });
});

// POST /api/auth/verify-email
router.post('/verify-email', async (request, env, ctx) => {
  const body = await parseBody(request);
  if (!body || !body.token) return errorResponse('Verification token required');

  const user = await env.ARENA_DB.prepare(
    `SELECT id FROM users WHERE verification_token = ? AND email_verified = 0`
  ).bind(body.token).first();

  if (!user) return errorResponse('Invalid or expired verification token', 400);

  await env.ARENA_DB.prepare(
    `UPDATE users SET email_verified = 1, verification_token = NULL, verification_status = 'verified', updated_at = datetime('now') WHERE id = ?`
  ).bind(user.id).run();

  auditLog(env.ARENA_DB, ctx, {
    actorId: user.id,
    action: 'user.verify_email',
    entityType: 'user',
    entityId: user.id,
    ipAddress: getClientIP(request),
  });

  return successResponse({ message: 'Email verified successfully' });
});

// GET /api/auth/me
router.get('/me', async (request, env) => {
  const user = await authenticate(request, env);
  if (!user) return errorResponse('Not authenticated', 401);

  return successResponse({ user });
});

export default router;
