/**
 * Arena — Auth Routes
 * POST /api/auth/register, login, verify-email, logout, forgot-password, reset-password
 */

import { Router } from 'itty-router';
import { hashPassword, verifyPassword, passwordNeedsRehash, createJWT, hashToken, generateVerificationToken, hashIP } from '../auth.js';
import { generateId } from '../db.js';
import { auditLog } from '../audit.js';
import { checkRateLimit, clearRateLimit } from '../ratelimit.js';
import { json, errorResponse, successResponse, parseBody, getClientIP } from '../middleware.js';
import { validate, registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } from '../validation.js';
import { authenticate } from '../auth.js';
import { isTransactionalEmailConfigured, sendAndRecordTransactionalEmail } from '../email.js';

const router = Router({ base: '/api/auth' });

// Rate limit policies (fixed windows)
const LOGIN_MAX_PER_IP = 20;        // per 15 min
const LOGIN_MAX_PER_EMAIL = 10;     // per 15 min
const LOGIN_WINDOW_SECONDS = 15 * 60;
const REGISTER_MAX_PER_IP = 5;      // per hour
const REGISTER_WINDOW_SECONDS = 60 * 60;
const VERIFY_EMAIL_MAX_PER_IP = 5;  // per 10 min
const VERIFY_EMAIL_WINDOW_SECONDS = 10 * 60;
const FORGOT_PASSWORD_MAX_PER_IP = 5;     // per hour
const FORGOT_PASSWORD_MAX_PER_EMAIL = 3;  // per hour
const FORGOT_PASSWORD_WINDOW_SECONDS = 60 * 60;
const RESET_PASSWORD_MAX_PER_IP = 10;     // per 15 min
const RESET_PASSWORD_WINDOW_SECONDS = 15 * 60;
const RESEND_VERIFICATION_MAX_PER_USER = 3; // per 10 min
const RESEND_VERIFICATION_WINDOW_SECONDS = 10 * 60;

async function getStaffLinks(env, userId) {
  const staffLinks = await env.ARENA_DB.prepare(
    `SELECT csl.*, c.name as candidate_name, c.party as candidate_party, c.race_id
     FROM candidate_staff_links csl
     JOIN candidates c ON csl.candidate_id = c.id
     WHERE csl.user_id = ? AND csl.is_active = 1`
  ).bind(userId).all();
  return staffLinks.results || [];
}

function getPasswordResetUrl(request, env, token) {
  const requestOrigin = new URL(request.url).origin;
  const baseUrl = (env.PASSWORD_RESET_BASE_URL || requestOrigin).replace(/\/+$/, '');
  return `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function deliverPasswordReset(request, env, user, token) {
  const resetUrl = getPasswordResetUrl(request, env, token);
  const subject = 'Reset your Arena password';
  const text = [
    'A password reset was requested for your Arena account.',
    '',
    'Use this link within 60 minutes:',
    resetUrl,
    '',
    'If you did not request this, you can ignore this email.',
  ].join('\n');
  const html = `
    <p>A password reset was requested for your Arena account.</p>
    <p><a href="${escapeHtml(resetUrl)}">Reset your password</a></p>
    <p>This link expires in 60 minutes.</p>
    <p>If you did not request this, you can ignore this email.</p>
  `;

  const result = await sendAndRecordTransactionalEmail(env.ARENA_DB, env, {
    to: user.email,
    subject,
    text,
    html,
    tag: 'password_reset',
    metadata: {
      type: 'password_reset',
      user_id: user.id,
      expires_in_minutes: 60,
    },
    idempotencyKey: `password-reset-${user.id}-${token.slice(0, 16)}`,
  }, {
    recipient_user_id: user.id,
    related_entity_type: 'user',
    related_entity_id: user.id,
    template_key: 'password_reset',
  });

  return { ...result, resetUrl };
}

function getEmailVerificationUrl(request, env, token) {
  const requestOrigin = new URL(request.url).origin;
  const baseUrl = (env.PASSWORD_RESET_BASE_URL || requestOrigin).replace(/\/+$/, '');
  return `${baseUrl}/verify-email?token=${encodeURIComponent(token)}`;
}

async function deliverEmailVerification(request, env, user, token) {
  const verifyUrl = getEmailVerificationUrl(request, env, token);
  const subject = 'Verify your Arena email address';
  const text = [
    'Welcome to Arena. Verify your email address to unlock voter actions',
    '(priorities, questions, and question votes).',
    '',
    'Verification link:',
    verifyUrl,
    '',
    'If you did not create this account, you can ignore this email.',
  ].join('\n');
  const html = `
    <p>Welcome to Arena. Verify your email address to unlock voter actions
    (priorities, questions, and question votes).</p>
    <p><a href="${escapeHtml(verifyUrl)}">Verify your email</a></p>
    <p>If you did not create this account, you can ignore this email.</p>
  `;

  const result = await sendAndRecordTransactionalEmail(env.ARENA_DB, env, {
    to: user.email,
    subject,
    text,
    html,
    tag: 'email_verification',
    metadata: {
      type: 'email_verification',
      user_id: user.id,
    },
    idempotencyKey: `email-verification-${user.id}-${token.slice(0, 16)}`,
  }, {
    recipient_user_id: user.id,
    related_entity_type: 'user',
    related_entity_id: user.id,
    template_key: 'email_verification',
  });

  return { ...result, verifyUrl };
}

// POST /api/auth/register
router.post('/register', async (request, env, ctx) => {
  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid request body');

  const { valid, errors, data } = validate(registerSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  // Rate limit registrations per IP
  const regIpHash = await hashIP(getClientIP(request), env);
  if (regIpHash) {
    const rl = await checkRateLimit(env.ARENA_DB, `register:${regIpHash}`, REGISTER_MAX_PER_IP, REGISTER_WINDOW_SECONDS);
    if (rl.limited) return errorResponse('Too many registration attempts. Please try again later.', 429);
  }

  // Check if email or username already exists
  const existing = await env.ARENA_DB.prepare(
    `SELECT id FROM users WHERE email = ? OR username = ?`
  ).bind(data.email.toLowerCase(), data.username.toLowerCase()).first();

  if (existing) return errorResponse('Email or username already taken', 409);

  const userId = generateId('usr');
  const passwordHash = await hashPassword(data.password);
  const verificationToken = generateVerificationToken();

  try {
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
  } catch (err) {
    // UNIQUE constraint race: two concurrent registrations with the same email/username
    if (String(err?.message || err).includes('UNIQUE')) {
      return errorResponse('Email or username already taken', 409);
    }
    throw err;
  }

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

  ctx.waitUntil(
    deliverEmailVerification(request, env, { id: userId, email: data.email.toLowerCase() }, verificationToken)
      .catch(err => console.error('Email verification delivery failed:', err)),
  );

  const responseData = {
    token,
    user: {
      id: userId,
      email: data.email.toLowerCase(),
      username: data.username.toLowerCase(),
      display_name: data.display_name,
      role: 'voter',
      email_verified: false,
      verification_status: 'unverified',
      staff_links: [],
    },
  };
  if (env.ENVIRONMENT !== 'production' || env.PASSWORD_RESET_EXPOSE_DEV_TOKEN === 'true') {
    responseData.dev_verification_token = verificationToken;
  }

  return successResponse(responseData);
});

// POST /api/auth/resend-verification — re-issue the email verification link
router.post('/resend-verification', async (request, env, ctx) => {
  const user = await authenticate(request, env);
  if (!user) return errorResponse('Not authenticated', 401);
  if (user.email_verified) return successResponse({ message: 'Email already verified' });

  const rl = await checkRateLimit(env.ARENA_DB, `resend-verification:${user.id}`, RESEND_VERIFICATION_MAX_PER_USER, RESEND_VERIFICATION_WINDOW_SECONDS);
  if (rl.limited) return errorResponse('Too many verification emails requested. Please try again later.', 429);

  const verificationToken = generateVerificationToken();
  await env.ARENA_DB.prepare(
    `UPDATE users SET verification_token = ?, updated_at = datetime('now') WHERE id = ? AND email_verified = 0`
  ).bind(verificationToken, user.id).run();

  ctx.waitUntil(
    deliverEmailVerification(request, env, user, verificationToken)
      .catch(err => console.error('Email verification delivery failed:', err)),
  );

  auditLog(env.ARENA_DB, ctx, {
    actorId: user.id,
    action: 'user.resend_verification',
    entityType: 'user',
    entityId: user.id,
    metadata: { delivery_configured: isTransactionalEmailConfigured(env) },
    ipAddress: getClientIP(request),
  });

  const responseData = { message: 'Verification email sent' };
  if (env.ENVIRONMENT !== 'production' || env.PASSWORD_RESET_EXPOSE_DEV_TOKEN === 'true') {
    responseData.dev_verification_token = verificationToken;
  }
  return successResponse(responseData);
});

// POST /api/auth/login
router.post('/login', async (request, env, ctx) => {
  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid request body');

  const { valid, errors, data } = validate(loginSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  // Rate limit login attempts per IP and per target email (brute-force defense)
  const loginIpHash = await hashIP(getClientIP(request), env);
  const emailKey = `login:email:${data.email.toLowerCase()}`;
  if (loginIpHash) {
    const rlIp = await checkRateLimit(env.ARENA_DB, `login:ip:${loginIpHash}`, LOGIN_MAX_PER_IP, LOGIN_WINDOW_SECONDS);
    if (rlIp.limited) return errorResponse('Too many login attempts. Please try again later.', 429);
  }
  const rlEmail = await checkRateLimit(env.ARENA_DB, emailKey, LOGIN_MAX_PER_EMAIL, LOGIN_WINDOW_SECONDS);
  if (rlEmail.limited) return errorResponse('Too many login attempts. Please try again later.', 429);

  const user = await env.ARENA_DB.prepare(
    `SELECT id, email, username, display_name, password_hash, role, email_verified, verification_status, party_affiliation, jurisdiction_state, jurisdiction_district, is_active FROM users WHERE email = ?`
  ).bind(data.email.toLowerCase()).first();

  if (!user || !user.is_active) return errorResponse('Invalid email or password', 401);

  const passwordValid = await verifyPassword(data.password, user.password_hash);
  if (!passwordValid) return errorResponse('Invalid email or password', 401);

  // Successful login resets the per-email failure window
  await clearRateLimit(env.ARENA_DB, emailKey);

  // Create session
  const sessionId = generateId('ses');
  const token = await createJWT({ userId: user.id, sessionId, role: user.role }, env);
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const updates = [
    env.ARENA_DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, ip_address, user_agent, expires_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(sessionId, user.id, tokenHash, getClientIP(request), request.headers.get('User-Agent'), expiresAt),
    env.ARENA_DB.prepare(
      `UPDATE users SET last_login = datetime('now') WHERE id = ?`
    ).bind(user.id),
  ];

  if (passwordNeedsRehash(user.password_hash)) {
    updates.push(
      env.ARENA_DB.prepare(
        `UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(await hashPassword(data.password), user.id)
    );
  }

  await env.ARENA_DB.batch(updates);

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
      staff_links: await getStaffLinks(env, user.id),
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

// POST /api/auth/forgot-password
router.post('/forgot-password', async (request, env, ctx) => {
  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid request body');

  const { valid, errors, data } = validate(forgotPasswordSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  // Rate limit per IP and per target email (email-bombing / write-amplification defense)
  const forgotIpHash = await hashIP(getClientIP(request), env);
  if (forgotIpHash) {
    const rlIp = await checkRateLimit(env.ARENA_DB, `forgot-password:ip:${forgotIpHash}`, FORGOT_PASSWORD_MAX_PER_IP, FORGOT_PASSWORD_WINDOW_SECONDS);
    if (rlIp.limited) return errorResponse('Too many password reset requests. Please try again later.', 429);
  }
  const rlEmail = await checkRateLimit(env.ARENA_DB, `forgot-password:email:${data.email.toLowerCase()}`, FORGOT_PASSWORD_MAX_PER_EMAIL, FORGOT_PASSWORD_WINDOW_SECONDS);
  if (rlEmail.limited) return errorResponse('Too many password reset requests. Please try again later.', 429);

  const generic = { message: 'If an account exists for that email, password reset instructions have been sent.' };
  const user = await env.ARENA_DB.prepare(
    `SELECT id, email FROM users WHERE email = ? AND is_active = 1`
  ).bind(data.email.toLowerCase()).first();

  if (!user) return successResponse(generic);

  const resetToken = generateVerificationToken();
  const resetHash = await hashToken(resetToken);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const resetUrl = getPasswordResetUrl(request, env, resetToken);

  await env.ARENA_DB.prepare(
    `UPDATE users
     SET password_reset_token_hash = ?, password_reset_expires_at = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).bind(resetHash, expiresAt, user.id).run();

  ctx.waitUntil(
    deliverPasswordReset(request, env, user, resetToken)
      .catch(err => console.error('Password reset delivery failed:', err)),
  );

  auditLog(env.ARENA_DB, ctx, {
    actorId: user.id,
    action: 'user.password_reset_requested',
    entityType: 'user',
    entityId: user.id,
    metadata: { delivery_configured: isTransactionalEmailConfigured(env) },
    ipAddress: getClientIP(request),
  });

  const responseData = { ...generic };
  if (env.ENVIRONMENT !== 'production' || env.PASSWORD_RESET_EXPOSE_DEV_TOKEN === 'true') {
    responseData.dev_reset_token = resetToken;
    responseData.reset_url = resetUrl;
  }

  return successResponse(responseData);
});

// POST /api/auth/reset-password
router.post('/reset-password', async (request, env, ctx) => {
  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid request body');

  const { valid, errors, data } = validate(resetPasswordSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  // Rate limit token-guessing attempts per IP
  const resetIpHash = await hashIP(getClientIP(request), env);
  if (resetIpHash) {
    const rlIp = await checkRateLimit(env.ARENA_DB, `reset-password:ip:${resetIpHash}`, RESET_PASSWORD_MAX_PER_IP, RESET_PASSWORD_WINDOW_SECONDS);
    if (rlIp.limited) return errorResponse('Too many password reset attempts. Please try again later.', 429);
  }

  const resetHash = await hashToken(data.token);
  const user = await env.ARENA_DB.prepare(
    `SELECT id FROM users
     WHERE password_reset_token_hash = ?
       AND password_reset_expires_at > datetime('now')
       AND is_active = 1`
  ).bind(resetHash).first();

  if (!user) return errorResponse('Invalid or expired reset token', 400);

  const passwordHash = await hashPassword(data.password);
  await env.ARENA_DB.batch([
    env.ARENA_DB.prepare(
      `UPDATE users
       SET password_hash = ?,
           password_reset_token_hash = NULL,
           password_reset_expires_at = NULL,
           updated_at = datetime('now')
       WHERE id = ?`
    ).bind(passwordHash, user.id),
    env.ARENA_DB.prepare(
      `UPDATE sessions SET is_active = 0 WHERE user_id = ?`
    ).bind(user.id),
  ]);

  auditLog(env.ARENA_DB, ctx, {
    actorId: user.id,
    action: 'user.password_reset',
    entityType: 'user',
    entityId: user.id,
    ipAddress: getClientIP(request),
  });

  return successResponse({ message: 'Password reset successfully' });
});

// POST /api/auth/verify-email
router.post('/verify-email', async (request, env, ctx) => {
  const body = await parseBody(request);
  if (!body || !body.token) return errorResponse('Verification token required');

  const verifyIpHash = await hashIP(getClientIP(request), env);
  if (verifyIpHash) {
    const rl = await checkRateLimit(env.ARENA_DB, `verify-email:${verifyIpHash}`, VERIFY_EMAIL_MAX_PER_IP, VERIFY_EMAIL_WINDOW_SECONDS);
    if (rl.limited) return errorResponse('Too many verification attempts. Please try again later.', 429);
  }

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
