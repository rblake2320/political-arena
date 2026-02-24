/**
 * Arena — Authentication Module
 * PBKDF2 password hashing + jose JWT (A256GCM encrypted)
 * Cloned from AIHangout worker.js auth pattern
 */

import { EncryptJWT, jwtDecrypt } from 'jose';

// ===== Password Hashing (PBKDF2) =====

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  const derivedKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  const exportedKey = await crypto.subtle.exportKey('raw', derivedKey);
  const hash = Array.from(new Uint8Array(exportedKey))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  const saltHex = Array.from(salt)
    .map(b => b.toString(16).padStart(2, '0')).join('');

  return `${saltHex}:${hash}`;
}

export async function verifyPassword(password, storedHash) {
  try {
    const [saltHex, hash] = storedHash.split(':');
    if (!saltHex || !hash) return false;

    const salt = new Uint8Array(
      saltHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
    );

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );

    const derivedKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      key,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );

    const exportedKey = await crypto.subtle.exportKey('raw', derivedKey);
    const computedHash = Array.from(new Uint8Array(exportedKey))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    return computedHash === hash;
  } catch (error) {
    console.error('Password verification error:', error);
    return false;
  }
}

// ===== JWT Utilities =====

async function getJWTKey(env) {
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
