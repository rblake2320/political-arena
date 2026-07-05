/**
 * Arena domain integration tests — real worker, real D1.
 * Covers: demo seed availability in test env, ad visibility rules,
 * the ad-activation authorization fix, and the challenge credit lifecycle.
 */
import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'https://example.com';
const VALID_PASSWORD = 'Str0ng!Passw0rd';

async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await SELF.fetch(`${BASE}${path}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(path, token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await SELF.fetch(`${BASE}${path}`, { headers });
  return { status: res.status, body: await res.json() };
}

async function registerUser(name) {
  const res = await post('/api/auth/register', {
    email: `${name}@example.com`,
    username: name,
    password: VALID_PASSWORD,
    display_name: name,
  });
  expect(res.status).toBe(200);
  return { token: res.body.data.token, id: res.body.data.user.id };
}

let staffUser;   // staff of cand-1 (seeded demo candidate)
let outsider;    // unrelated voter

beforeAll(async () => {
  // Touch the API once so the worker bootstraps schema + demo seed data
  await SELF.fetch(`${BASE}/api/health`);

  staffUser = await registerUser('staffer');
  outsider = await registerUser('outsider');

  // Link staffer to seeded candidate cand-1 (direct D1 write — same DB the worker uses)
  await env.ARENA_DB.prepare(
    `INSERT OR IGNORE INTO candidate_staff_links (id, user_id, candidate_id, role, is_active)
     VALUES ('link-test-1', ?, 'cand-1', 'primary', 1)`
  ).bind(staffUser.id).run();
});

describe('races & demo seed (test env only)', () => {
  it('lists seeded races', async () => {
    const res = await get('/api/races');
    expect(res.status).toBe(200);
    const races = res.body.data.races;
    expect(races.length).toBeGreaterThanOrEqual(3);
    expect(races.some(r => r.id === 'race-1')).toBe(true);
  });

  it('serves active ads for a race with paired rebuttals', async () => {
    const res = await get('/api/ads/races/race-1');
    expect(res.status).toBe(200);
    const ads = res.body.data.ads;
    expect(ads.length).toBeGreaterThanOrEqual(1);
    const ad1 = ads.find(a => a.id === 'ad-1');
    expect(ad1).toBeTruthy();
    expect(Array.isArray(ad1.rebuttals)).toBe(true);
  });
});

describe('ad visibility & activation authorization', () => {
  beforeAll(async () => {
    // A draft ad and an approved ad owned by cand-1, inserted directly in D1
    await env.ARENA_DB.batch([
      env.ARENA_DB.prepare(
        `INSERT OR IGNORE INTO ad_flights (id, race_id, candidate_id, created_by, title, ad_content_text, disclaimer_text, status)
         VALUES ('ad-test-draft', 'race-1', 'cand-1', ?, 'Draft Ad', 'Unpublished content', 'Paid for by test', 'draft')`
      ).bind(staffUser.id),
      env.ARENA_DB.prepare(
        `INSERT OR IGNORE INTO ad_flights (id, race_id, candidate_id, created_by, title, ad_content_text, disclaimer_text, status)
         VALUES ('ad-test-approved', 'race-1', 'cand-1', ?, 'Approved Ad', 'Approved content', 'Paid for by test', 'approved')`
      ).bind(staffUser.id),
    ]);
  });

  it('hides draft ads from anonymous users (404, not content leak)', async () => {
    const res = await get('/api/ads/ad-test-draft');
    expect(res.status).toBe(404);
  });

  it('hides draft ads from unrelated authenticated users', async () => {
    const res = await get('/api/ads/ad-test-draft', outsider.token);
    expect(res.status).toBe(404);
  });

  it('shows draft ads to the owning candidate staff', async () => {
    const res = await get('/api/ads/ad-test-draft', staffUser.token);
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Draft Ad');
  });

  it('REGRESSION: a non-staff user cannot activate another candidate ad', async () => {
    const res = await post('/api/ads/ad-test-approved/activate', {}, outsider.token);
    expect(res.status).toBe(403);

    // Verify state did not change
    const row = await env.ARENA_DB.prepare(`SELECT status FROM ad_flights WHERE id = 'ad-test-approved'`).first();
    expect(row.status).toBe('approved');
  });

  it('candidate staff CAN activate their own approved ad', async () => {
    const res = await post('/api/ads/ad-test-approved/activate', {}, staffUser.token);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('active');
  });
});

describe('challenge credit lifecycle', () => {
  it('issuing a challenge atomically deducts one credit', async () => {
    const before = await env.ARENA_DB.prepare(`SELECT credit_balance FROM candidates WHERE id = 'cand-1'`).first();

    const res = await post('/api/challenges', {
      race_id: 'race-1',
      challenger_candidate_id: 'cand-1',
      target_candidate_id: 'cand-2',
      challenge_text: 'Explain your position on infrastructure funding in detail.',
      challenge_type: 'policy_question',
    }, staffUser.token);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('open');
    expect(res.body.data.credits_remaining).toBe(before.credit_balance - 1);

    // Credit transaction ledger recorded the deduction
    const tx = await env.ARENA_DB.prepare(
      `SELECT amount, transaction_type FROM credit_transactions WHERE reference_id = ?`
    ).bind(res.body.data.id).first();
    expect(tx.amount).toBe(-1);
    expect(tx.transaction_type).toBe('deduction');
  });

  it('enforces the challenger->target cooldown', async () => {
    const res = await post('/api/challenges', {
      race_id: 'race-1',
      challenger_candidate_id: 'cand-1',
      target_candidate_id: 'cand-2',
      challenge_text: 'A second challenge inside the cooldown window should fail.',
    }, staffUser.token);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cooldown/i);
  });

  it('an outsider cannot issue a challenge on behalf of a candidate', async () => {
    const res = await post('/api/challenges', {
      race_id: 'race-1',
      challenger_candidate_id: 'cand-1',
      target_candidate_id: 'cand-2',
      challenge_text: 'This request is not from candidate staff and must be rejected.',
    }, outsider.token);
    expect(res.status).toBe(403);
  });

  it('withdrawing an open challenge refunds the credit', async () => {
    // Fresh pair without cooldown: cand-1 -> use a different target (cand-1 vs cand-2 on cooldown)
    // race-1 only has cand-1/cand-2, so withdraw the existing open challenge instead.
    const open = await env.ARENA_DB.prepare(
      `SELECT id FROM challenges WHERE challenger_candidate_id = 'cand-1' AND status = 'open' ORDER BY created_at DESC LIMIT 1`
    ).first();
    expect(open).toBeTruthy();

    const before = await env.ARENA_DB.prepare(`SELECT credit_balance FROM candidates WHERE id = 'cand-1'`).first();
    const res = await post(`/api/challenges/${open.id}/withdraw`, {}, staffUser.token);
    expect(res.status).toBe(200);
    expect(res.body.data.credits_remaining).toBe(before.credit_balance + 1);
  });
});

describe('audit trail', () => {
  it('records audit entries for security-relevant actions', async () => {
    const rows = await env.ARENA_DB.prepare(
      `SELECT action FROM audit_log WHERE action IN ('user.register', 'challenge.issue', 'ad.activate')`
    ).all();
    const actions = new Set((rows.results || []).map(r => r.action));
    expect(actions.has('user.register')).toBe(true);
    expect(actions.has('challenge.issue')).toBe(true);
    expect(actions.has('ad.activate')).toBe(true);
  });
});

describe('security: forgot/reset password', () => {
  it('forgot-password always returns success (no email enumeration)', async () => {
    const r1 = await post('/api/auth/forgot-password', { email: 'nobody@unknown.invalid' });
    expect(r1.status).toBe(200);

    const r2 = await post('/api/auth/forgot-password', { email: 'staffer@example.com' });
    expect(r2.status).toBe(200);
    // Both responses look identical to prevent enumeration
    expect(r1.body.data.message).toBe(r2.body.data.message);
  });

  it('reset-password rejects invalid token with 400', async () => {
    const res = await post('/api/auth/reset-password', {
      token: 'deadbeef'.repeat(8),
      password: VALID_PASSWORD,
    });
    expect(res.status).toBe(400);
  });

  it('full forgot→reset→login flow works end-to-end', async () => {
    const reg = await post('/api/auth/register', {
      email: 'resetme@example.com',
      username: 'resetme',
      password: VALID_PASSWORD,
      display_name: 'ResetMe',
    });
    expect(reg.status).toBe(200);

    // Forgot password — dev env returns the raw token
    const forgot = await post('/api/auth/forgot-password', { email: 'resetme@example.com' });
    expect(forgot.status).toBe(200);
    expect(forgot.body.data.reset_token).toBeTruthy(); // only present outside production

    const resetToken = forgot.body.data.reset_token;

    // Old session should still work before reset
    const beforeReset = await get('/api/auth/me', reg.body.data.token);
    expect(beforeReset.status).toBe(200);

    // Reset password
    const newPassword = 'N3wStr0ng!Pass';
    const reset = await post('/api/auth/reset-password', { token: resetToken, password: newPassword });
    expect(reset.status).toBe(200);

    // Old token should now be invalidated (session wiped on reset)
    const afterReset = await get('/api/auth/me', reg.body.data.token);
    expect(afterReset.status).toBe(401);

    // Can log in with new password
    const login = await post('/api/auth/login', { email: 'resetme@example.com', password: newPassword });
    expect(login.status).toBe(200);

    // Cannot reuse the same reset token
    const reuse = await post('/api/auth/reset-password', { token: resetToken, password: VALID_PASSWORD });
    expect(reuse.status).toBe(400);
  });
});

describe('security: analytics user_id stripping', () => {
  it('ignores client-supplied user_id and session_id', async () => {
    const fakeUserId = 'usr_attacker_injected';
    await post('/api/analytics/events', {
      events: [{ event_type: 'view', user_id: fakeUserId, session_id: 'ses_fake', race_id: 'race-1' }],
    });

    // The injected user_id must NOT appear in the analytics table
    const row = await env.ARENA_DB.prepare(
      `SELECT user_id, session_id FROM analytics_events WHERE race_id = 'race-1' ORDER BY created_at DESC LIMIT 1`
    ).first();
    expect(row?.user_id).not.toBe(fakeUserId);
    expect(row?.session_id).toBeNull();
  });

  it('stores authenticated user_id when request is authenticated', async () => {
    const reg = await post('/api/auth/register', {
      email: 'analytic_user@example.com',
      username: 'analytic_user',
      password: VALID_PASSWORD,
      display_name: 'Analytic',
    });
    const token = reg.body.data.token;
    const userId = reg.body.data.user.id;

    await post('/api/analytics/events', {
      events: [{ event_type: 'pageview', race_id: 'race-2' }],
    }, token);

    const row = await env.ARENA_DB.prepare(
      `SELECT user_id FROM analytics_events WHERE race_id = 'race-2' AND user_id = ? ORDER BY created_at DESC LIMIT 1`
    ).bind(userId).first();
    expect(row?.user_id).toBe(userId);
  });

  it('rejects oversized metadata (over 1000 chars)', async () => {
    // Even if the event is accepted (we don't reject on analytics), large metadata is discarded
    const bigMeta = { data: 'x'.repeat(2000) };
    await post('/api/analytics/events', {
      events: [{ event_type: 'pageview', metadata: bigMeta, race_id: 'race-3' }],
    });

    const row = await env.ARENA_DB.prepare(
      `SELECT metadata FROM analytics_events WHERE race_id = 'race-3' ORDER BY created_at DESC LIMIT 1`
    ).first();
    // metadata should be null (discarded because it exceeded 1000 chars)
    expect(row?.metadata).toBeNull();
  });
});

describe('security: staff role validation', () => {
  it('rejects non-staff user attempting to assign the primary role', async () => {
    const { token, id } = await registerUser('roleatk');
    // Make them staff of cand-1 first (as viewer)
    await env.ARENA_DB.prepare(
      `INSERT OR IGNORE INTO candidate_staff_links (id, user_id, candidate_id, role, is_active) VALUES ('sl-roleatk', ?, 'cand-1', 'staff', 1)`
    ).bind(id).run();

    // Register another user to add
    const target = await registerUser('roletarget');

    // Staff cannot promote to primary
    const res = await post('/api/candidates/cand-1/staff', { user_id: target.id, role: 'primary' }, token);
    expect(res.status).toBe(403);
  });

  it('allows valid role values (staff, viewer)', async () => {
    const { token } = staffUser; // primary staff linked in beforeAll
    const newStaffer = await registerUser('newstaffer_role');

    const res = await post('/api/candidates/cand-1/staff', { user_id: newStaffer.id, role: 'viewer' }, token);
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('viewer');
  });
});

describe('security: reactions content_type validation', () => {
  it('rejects invalid content_type in /reactions/counts', async () => {
    const res = await get('/api/reactions/counts?content_type=evil_type&content_id=ad-1');
    expect(res.status).toBe(400);
  });

  it('accepts valid content_type', async () => {
    const res = await get('/api/reactions/counts?content_type=ad&content_id=ad-1');
    expect(res.status).toBe(200);
  });
});
