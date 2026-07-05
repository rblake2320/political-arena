/**
 * Arena — Middleware Module
 * Auth guards, role checks, verification gates
 */

import { authenticate } from './auth.js';

// JSON response helper
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function errorResponse(message, status = 400) {
  return json({ success: false, error: message }, status);
}

export function successResponse(data) {
  return json({ success: true, data });
}

// ===== Auth Middleware =====

/**
 * Require authenticated user. Attaches user to request.
 */
export async function requireAuth(request, env) {
  const user = await authenticate(request, env);
  if (!user) {
    return errorResponse('Authentication required', 401);
  }
  request.user = user;
  return null; // No error, continue
}

/**
 * Optional auth — attaches user if present, but doesn't fail
 */
export async function optionalAuth(request, env) {
  const user = await authenticate(request, env);
  request.user = user || null;
  return null;
}

/**
 * Require specific role(s)
 */
export function requireRole(...roles) {
  return async (request, env) => {
    const authError = await requireAuth(request, env);
    if (authError) return authError;

    if (!roles.includes(request.user.role)) {
      return errorResponse('Insufficient permissions', 403);
    }
    return null;
  };
}

/**
 * Require verified voter (verification_status = 'verified')
 */
export async function requireVerifiedVoter(request, env) {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  if (request.user.verification_status !== 'verified') {
    return errorResponse('Account verification required. Please verify your identity to perform this action.', 403);
  }
  return null;
}

/**
 * Require user to be staff of a specific candidate
 */
export async function requireCandidateStaff(request, env, candidateId) {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const link = await env.ARENA_DB.prepare(
    `SELECT id, role FROM candidate_staff_links WHERE user_id = ? AND candidate_id = ? AND is_active = 1`
  ).bind(request.user.id, candidateId).first();

  if (!link) {
    return errorResponse('You are not authorized to act on behalf of this candidate', 403);
  }

  request.staffRole = link.role;
  return null;
}

/**
 * Require approved press credentials
 */
export async function requireApprovedPress(request, env) {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const cred = await env.ARENA_DB.prepare(
    `SELECT status FROM press_credentials WHERE user_id = ? AND status = 'approved'`
  ).bind(request.user.id).first();
  if (!cred) {
    return errorResponse('Approved press credentials required', 403);
  }
  return null;
}

// ===== CORS Helper =====

// Allowed origins for CORS. Same-origin requests don't need CORS,
// but local dev and alternate domains do.
const ALLOWED_ORIGINS = [
  'https://political-arena.rblake2320.workers.dev',
  'https://political-arena.pages.dev',
  'http://localhost:5173',
  'http://localhost:3000',
];

export function corsHeaders(request) {
  const origin = request?.headers?.get('Origin');
  // Only reflect origin if it's on the allowlist
  const allowedOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export function handleCORS(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  return null;
}

// ===== Pagination Helper =====

export function parsePagination(url) {
  const rawPage = parseInt(url.searchParams.get('page') || '1');
  const rawLimit = parseInt(url.searchParams.get('limit') || '20');
  const page = Math.max(1, Number.isFinite(rawPage) ? rawPage : 1);
  const limit = Math.min(100, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 20));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

// ===== Request Helpers =====

export async function parseBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function getClientIP(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || null;
}
