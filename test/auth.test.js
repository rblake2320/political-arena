/**
 * Auth integration tests — run against the real worker in workerd with real D1.
 * Covers: register, login, session-bound JWT, logout invalidation,
 * duplicate rejection, password policy, and login rate limiting.
 */
import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

const BASE = 'https://example.com';

async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await SELF.fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(path, token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await SELF.fetch(`${BASE}${path}`, { headers });
  return { status: res.status, body: await res.json() };
}

const VALID_PASSWORD = 'Str0ng!Passw0rd';

describe('health & headers', () => {
  it('GET /api/health returns ok with security headers', async () => {
    const res = await SELF.fetch(`${BASE}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
  });

  it('unknown API route returns JSON 404', async () => {
    const res = await SELF.fetch(`${BASE}/api/definitely-not-a-route`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});

describe('registration', () => {
  it('registers a new user and returns a working token', async () => {
    const reg = await post('/api/auth/register', {
      email: 'alice@example.com',
      username: 'alice',
      password: VALID_PASSWORD,
      display_name: 'Alice',
    });
    expect(reg.status).toBe(200);
    expect(reg.body.success).toBe(true);
    expect(reg.body.data.token).toBeTruthy();
    expect(reg.body.data.user.role).toBe('voter');

    const me = await get('/api/auth/me', reg.body.data.token);
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe('alice@example.com');
  });

  it('rejects a duplicate email with 409', async () => {
    const dup = await post('/api/auth/register', {
      email: 'alice@example.com',
      username: 'alice2',
      password: VALID_PASSWORD,
      display_name: 'Alice Again',
    });
    expect(dup.status).toBe(409);
  });

  it('rejects a weak password', async () => {
    const weak = await post('/api/auth/register', {
      email: 'weak@example.com',
      username: 'weakuser',
      password: 'password',
      display_name: 'Weak',
    });
    expect(weak.status).toBe(400);
  });

  it('rejects an invalid username (special chars)', async () => {
    const bad = await post('/api/auth/register', {
      email: 'bad@example.com',
      username: 'bad user!!',
      password: VALID_PASSWORD,
      display_name: 'Bad',
    });
    expect(bad.status).toBe(400);
  });
});

describe('login & sessions', () => {
  it('logs in with correct credentials', async () => {
    const login = await post('/api/auth/login', {
      email: 'alice@example.com',
      password: VALID_PASSWORD,
    });
    expect(login.status).toBe(200);
    expect(login.body.data.token).toBeTruthy();
  });

  it('rejects a wrong password with 401', async () => {
    const login = await post('/api/auth/login', {
      email: 'alice@example.com',
      password: 'Wr0ng!Passw0rd',
    });
    expect(login.status).toBe(401);
  });

  it('invalidates the session on logout (session-bound JWT)', async () => {
    const login = await post('/api/auth/login', {
      email: 'alice@example.com',
      password: VALID_PASSWORD,
    });
    const token = login.body.data.token;

    const meBefore = await get('/api/auth/me', token);
    expect(meBefore.status).toBe(200);

    const logout = await post('/api/auth/logout', {}, token);
    expect(logout.status).toBe(200);

    // The JWT itself is still cryptographically valid, but the session is dead
    const meAfter = await get('/api/auth/me', token);
    expect(meAfter.status).toBe(401);
  });

  it('rejects a garbage token', async () => {
    const me = await get('/api/auth/me', 'not-a-real-token');
    expect(me.status).toBe(401);
  });
});

describe('login rate limiting', () => {
  it('returns 429 after exceeding the per-email failure limit', async () => {
    // Register a dedicated victim account so this test is self-contained
    await post('/api/auth/register', {
      email: 'victim@example.com',
      username: 'victim',
      password: VALID_PASSWORD,
      display_name: 'Victim',
    });

    let sawTooMany = false;
    // Per-email limit is 10 per window; the 11th+ attempt must be blocked
    for (let i = 0; i < 12; i++) {
      const res = await post('/api/auth/login', {
        email: 'victim@example.com',
        password: 'Wr0ng!Passw0rd',
      });
      if (res.status === 429) { sawTooMany = true; break; }
      expect(res.status).toBe(401);
    }
    expect(sawTooMany).toBe(true);

    // Even the CORRECT password is now blocked — the window must expire first
    const blocked = await post('/api/auth/login', {
      email: 'victim@example.com',
      password: VALID_PASSWORD,
    });
    expect(blocked.status).toBe(429);
  });
});
