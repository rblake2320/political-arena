/**
 * Arena — Authentication Module
 * PBKDF2 password hashing + jose JWT (A256GCM encrypted)
 * Cloned from AIHangout worker.js auth pattern
 */

import { EncryptJWT, jwtDecrypt } from 'jose';

// ===== Password Hashing (PBKDF2) =====

export const PASSWORD_HASH_ALGORITHM = 'pbkdf2_sha256';
export const PBKDF2_ITERATIONS = 600000;
const LEGACY_PBKDF2_ITERATIONS = 100000;

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  if (!/^[a-f0-9]+$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error('Invalid hex input');
  }
  return new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
}

async function derivePasswordHash(password, salt, iterations) {
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    passwordKey,
    256
  );

  return bytesToHex(new Uint8Array(derivedBits));
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePasswordHash(password, salt, PBKDF2_ITERATIONS);
  return `${PASSWORD_HASH_ALGORITHM}$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${hash}`;
}

function parsePasswordHash(storedHash) {
  if (typeof storedHash !== 'string') return null;

  const versionedParts = storedHash.split('$');
  if (versionedParts.length === 4) {
    const [algorithm, iterationsText, saltHex, hashHex] = versionedParts;
    const iterations = Number(iterationsText);
    if (algorithm !== PASSWORD_HASH_ALGORITHM || !Number.isInteger(iterations) || iterations < 1) return null;
    return { algorithm, iterations, saltHex, hashHex };
  }

  const legacyParts = storedHash.split(':');
  if (legacyParts.length === 2) {
    const [saltHex, hashHex] = legacyParts;
    return {
      algorithm: 'legacy_pbkdf2_sha256',
      iterations: LEGACY_PBKDF2_ITERATIONS,
      saltHex,
      hashHex,
    };
  }

  return null;
}

export async function verifyPassword(password, storedHash) {
  try {
    const parsed = parsePasswordHash(storedHash);
    if (!parsed) return false;

    const computedHash = await derivePasswordHash(password, hexToBytes(parsed.saltHex), parsed.iterations);
    return timingSafeEqual(computedHash, parsed.hashHex);
  } catch (error) {
    console.error('Password verification error:', error);
    return false;
  }
}

export function passwordNeedsRehash(storedHash) {
  const parsed = parsePasswordHash(storedHash);
  if (!parsed) return true;
  return parsed.algorithm !== PASSWORD_HASH_ALGORITHM || parsed.iterations < PBKDF2_ITERATIONS;
}

// Constant-time string comparison — avoids leaking match position via timing
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ===== JWT Utilities =====

async function getJWTKey(env) {
  // Fail closed: a production deployment must never run on the dev fallback secret.
  if (!env.JWT_SECRET && env.ENVIRONMENT === 'production') {
    throw new Error('JWT_SECRET is not configured. Set it with: wrangler secret put JWT_SECRET');
  }
  const secretStr = env.JWT_SECRET || 'arena-dev-secret-change-in-production';
  const encoded = new TextEncoder().encode(secretStr);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return new Uint8Array(hashBuffer);
}

export async function createJWT(payload, env) {
  const secret = await getJWTKey(env);
  return await new EncryptJWT(payload)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .encrypt(secret);
}

export async function verifyJWT(token, env) {
  try {
    const secret = await getJWTKey(env);
    const { payload } = await jwtDecrypt(token, secret);
    return payload;
  } catch {
    return null;
  }
}

// ===== Session-Bound Authentication =====

export async function authenticate(request, env) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return null;

  const payload = await verifyJWT(token, env);
  if (!payload || !payload.userId || !payload.sessionId) return null;

  // Session-bound: verify session is still active
  const session = await env.ARENA_DB.prepare(
    `SELECT id FROM sessions WHERE id = ? AND user_id = ? AND is_active = 1 AND expires_at > datetime('now')`
  ).bind(payload.sessionId, payload.userId).first();

  if (!session) return null;

  // Get user
  const user = await env.ARENA_DB.prepare(
    `SELECT id, email, username, display_name, role, email_verified, verification_status, party_affiliation, jurisdiction_state, jurisdiction_district, is_active FROM users WHERE id = ? AND is_active = 1`
  ).bind(payload.userId).first();

  return user || null;
}

// ===== Helpers =====

export async function hashToken(token) {
  const encoded = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hashIP(ip) {
  if (!ip) return null;
  const encoded = new TextEncoder().encode(ip + 'arena-ip-salt');
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

export function generateVerificationToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
