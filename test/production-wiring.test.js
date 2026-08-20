/**
 * Production-wiring regression tests — real worker + D1 in workerd.
 * Covers the 2026-08-20 gap-closing pass: email verification delivery flow,
 * staff_links in auth responses, ad/rebuttal lifecycle, starter credits,
 * platform_claim visibility, moderation takedown, config endpoint, and
 * forgot-password rate limiting.
 */
import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

const BASE = 'https://example.com';
const VALID_PASSWORD = 'Str0ng!Passw0rd';
let seq = 0;

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await SELF.fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
const post = (p, b, t) => req('POST', p, b, t);
const put = (p, b, t) => req('PUT', p, b, t);
const get = (p, t) => req('GET', p, undefined, t);

async function registerUser(label) {
  seq += 1;
  const suffix = `${Date.now().toString(36)}${seq}`;
  const res = await post('/api/auth/register', {
    email: `${label}-${suffix}@example.com`,
    username: `pw_${label}_${suffix}`.slice(0, 30),
    password: VALID_PASSWORD,
    display_name: `PW ${label}`,
  });
  expect(res.status).toBe(200);
  return { token: res.body.data.token, id: res.body.data.user.id, email: res.body.data.user.email, body: res.body.data };
}

async function makeRole(label, role) {
  const user = await registerUser(label);
  await env.ARENA_DB.prepare(
    `UPDATE users SET role = ?, verification_status = 'verified', email_verified = 1 WHERE id = ?`
  ).bind(role, user.id).run();
  return user;
}

describe('email verification flow', () => {
  it('register returns a dev verification token and verify-email unlocks voter actions', async () => {
    const user = await registerUser('verifyflow');
    expect(user.body.dev_verification_token).toBeTruthy();
    expect(user.body.user.staff_links).toEqual([]);

    // Unverified voter is blocked from verified-voter writes
    const blocked = await post('/api/surveys/my-priorities', { priorities: [{ issue_category_id: 'cat-1', priority_rank: 1 }] }, user.token);
    expect(blocked.status).toBe(403);

    const verify = await post('/api/auth/verify-email', { token: user.body.dev_verification_token });
    expect(verify.status).toBe(200);

    const allowed = await post('/api/surveys/my-priorities', { priorities: [{ issue_category_id: 'cat-1', priority_rank: 1 }] }, user.token);
    expect(allowed.status).toBe(200);
  });

  it('resend-verification issues a fresh working token', async () => {
    const user = await registerUser('resend');
    const resend = await post('/api/auth/resend-verification', {}, user.token);
    expect(resend.status).toBe(200);
    expect(resend.body.data.dev_verification_token).toBeTruthy();
    // Old token was replaced
    const old = await post('/api/auth/verify-email', { token: user.body.dev_verification_token });
    expect(old.status).toBe(400);
    const fresh = await post('/api/auth/verify-email', { token: resend.body.data.dev_verification_token });
    expect(fresh.status).toBe(200);
  });

  it('login response includes staff_links', async () => {
    const user = await registerUser('stafflinks');
    const login = await post('/api/auth/login', { email: user.email, password: VALID_PASSWORD });
    expect(login.status).toBe(200);
    expect(Array.isArray(login.body.data.user.staff_links)).toBe(true);
  });
});

describe('platform config', () => {
  it('GET /api/stats/config is public and typed', async () => {
    const res = await get('/api/stats/config');
    expect(res.status).toBe(200);
    expect(res.body.data.rebuttal_window_hours).toBeGreaterThan(0);
    expect(res.body.data.max_challenges_per_day).toBeGreaterThan(0);
    expect(res.body.data.max_rebuttals_per_ad).toBeGreaterThan(0);
  });
});

describe('candidate registration and visibility', () => {
  it('platform_claim candidates stay hidden from public race lists until verified, and verification grants 50 starter credits', async () => {
    const owner = await registerUser('claimant');
    const admin = await makeRole('verifier', 'admin');

    const created = await post('/api/candidates', {
      race_id: 'race-1',
      name: 'Pat Newcomer',
      party: 'Independent',
    }, owner.token);
    expect(created.status).toBe(200);
    const candId = created.body.data.id;

    const publicList = await get('/api/candidates/races/race-1');
    expect(publicList.body.data.candidates.some(c => c.id === candId)).toBe(false);

    const verified = await post(`/api/candidates/${candId}/verify`, { action: 'verify' }, admin.token);
    expect(verified.status).toBe(200);

    const afterList = await get('/api/candidates/races/race-1');
    expect(afterList.body.data.candidates.some(c => c.id === candId)).toBe(true);

    const credits = await get(`/api/credits/${candId}`, owner.token);
    expect(credits.status).toBe(200);
    expect(credits.body.data.credit_balance).toBe(50);

    // Re-verifying must not double-grant
    await env.ARENA_DB.prepare(`UPDATE candidates SET verification_status = 'pending' WHERE id = ?`).bind(candId).run();
    await post(`/api/candidates/${candId}/verify`, { action: 'verify' }, admin.token);
    const creditsAgain = await get(`/api/credits/${candId}`, owner.token);
    expect(creditsAgain.body.data.credit_balance).toBe(50);
  });

  it('moderators can verify candidates (queue access parity)', async () => {
    const owner = await registerUser('modclaim');
    const moderator = await makeRole('modverifier', 'moderator');
    const created = await post('/api/candidates', {
      race_id: 'race-2',
      name: 'Mod Verified',
      party: 'Independent',
    }, owner.token);
    expect(created.status).toBe(200);
    const res = await post(`/api/candidates/${created.body.data.id}/verify`, { action: 'verify' }, moderator.token);
    expect(res.status).toBe(200);
  });
});

describe('challenge issuing guards', () => {
  it('unverified challenger candidates cannot issue callouts', async () => {
    const owner = await registerUser('unverifchal');
    const created = await post('/api/candidates', {
      race_id: 'race-3',
      name: 'Unverified Challenger',
      party: 'Independent',
    }, owner.token);
    expect(created.status).toBe(200);
    const candId = created.body.data.id;
    // Give it a credit so the failure is the verification gate, not 402
    await env.ARENA_DB.prepare(`UPDATE candidates SET credit_balance = 5 WHERE id = ?`).bind(candId).run();

    const target = await env.ARENA_DB.prepare(
      `SELECT id FROM candidates WHERE race_id = 'race-3' AND id != ? AND is_active = 1 LIMIT 1`
    ).bind(candId).first();
    expect(target).toBeTruthy();

    const res = await post('/api/challenges', {
      race_id: 'race-3',
      challenger_candidate_id: candId,
      target_candidate_id: target.id,
      challenge_type: 'policy_question',
      challenge_text: 'Please explain your position on this policy in detail.',
    }, owner.token);
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('verified');
  });
});

describe('moderation takedown', () => {
  it('challenge visibility can be hidden with a reason and restored', async () => {
    const moderator = await makeRole('takedown', 'moderator');
    const challenge = await env.ARENA_DB.prepare(
      `SELECT id FROM challenges WHERE is_visible = 1 LIMIT 1`
    ).first();
    expect(challenge).toBeTruthy();

    const noReason = await put(`/api/challenges/${challenge.id}/visibility`, { is_visible: false }, moderator.token);
    expect(noReason.status).toBe(400);

    const hidden = await put(`/api/challenges/${challenge.id}/visibility`, { is_visible: false, reason: 'test takedown' }, moderator.token);
    expect(hidden.status).toBe(200);

    const receipt = await get(`/api/challenges/${challenge.id}/receipt`);
    expect(receipt.status).toBe(404);

    const restored = await put(`/api/challenges/${challenge.id}/visibility`, { is_visible: true }, moderator.token);
    expect(restored.status).toBe(200);
    const receiptBack = await get(`/api/challenges/${challenge.id}/receipt`);
    expect(receiptBack.status).toBe(200);
  });

  it('voters cannot use the takedown endpoint', async () => {
    const voter = await registerUser('novisibility');
    const challenge = await env.ARENA_DB.prepare(`SELECT id FROM challenges LIMIT 1`).first();
    const res = await put(`/api/challenges/${challenge.id}/visibility`, { is_visible: false, reason: 'nope' }, voter.token);
    expect(res.status).toBe(403);
  });
});

describe('ad and rebuttal lifecycle', () => {
  it('ad: create → submit → moderation queue → approve → activate; rebuttal: create → queue → approve → public', async () => {
    const moderator = await makeRole('admod', 'moderator');

    // Two verified candidates with staff in the same race, via demo data
    const staffA = await registerUser('adstaffa');
    const staffB = await registerUser('adstaffb');
    await env.ARENA_DB.batch([
      env.ARENA_DB.prepare(`INSERT OR IGNORE INTO candidate_staff_links (id, user_id, candidate_id, role, is_active) VALUES (?, ?, 'cand-1', 'primary', 1)`).bind(`pw-link-a-${staffA.id}`, staffA.id),
      env.ARENA_DB.prepare(`INSERT OR IGNORE INTO candidate_staff_links (id, user_id, candidate_id, role, is_active) VALUES (?, ?, 'cand-2', 'primary', 1)`).bind(`pw-link-b-${staffB.id}`, staffB.id),
      env.ARENA_DB.prepare(`UPDATE candidates SET verification_status = 'verified' WHERE id IN ('cand-1','cand-2')`),
    ]);

    const created = await post('/api/ads', {
      race_id: 'race-1',
      candidate_id: 'cand-1',
      title: 'Lifecycle test ad',
      ad_content_text: 'A test ad moving through the full review lifecycle.',
      disclaimer_text: 'Paid for by Lifecycle Test Committee.',
      media_type: 'text',
    }, staffA.token);
    expect(created.status).toBe(200);
    const adId = created.body.data.id;

    const submitted = await post(`/api/ads/${adId}/submit`, {}, staffA.token);
    expect(submitted.status).toBe(200);

    const queue = await get('/api/ads/moderation-queue', moderator.token);
    expect(queue.status).toBe(200);
    expect(queue.body.data.ads.some(a => a.id === adId)).toBe(true);

    const approved = await post(`/api/ads/${adId}/review`, { action: 'approve' }, moderator.token);
    expect(approved.status).toBe(200);

    // Moderation queue row resolved, not write-only
    const modRow = await env.ARENA_DB.prepare(
      `SELECT status FROM moderation_queue WHERE content_type = 'ad_flight' AND content_id = ?`
    ).bind(adId).first();
    expect(modRow.status).toBe('final');

    const activated = await post(`/api/ads/${adId}/activate`, {}, staffA.token);
    expect(activated.status).toBe(200);

    // Rebuttal from the opposing campaign goes straight to the queue
    const rebuttal = await post('/api/ads/rebuttals', {
      parent_ad_id: adId,
      candidate_id: 'cand-2',
      response_text: 'Our answer to this ad, on the record.',
      disclaimer_text: 'Paid for by Opposing Test Committee.',
    }, staffB.token);
    expect(rebuttal.status).toBe(200);
    expect(rebuttal.body.data.status).toBe('submitted');
    const rebId = rebuttal.body.data.id;

    const queue2 = await get('/api/ads/moderation-queue', moderator.token);
    expect(queue2.body.data.rebuttals.some(r => r.id === rebId)).toBe(true);

    const rebApproved = await put(`/api/ads/rebuttals/${rebId}/review`, { action: 'approve' }, moderator.token);
    expect(rebApproved.status).toBe(200);
    expect(rebApproved.body.data.status).toBe('active');

    // Publicly visible, paired with the parent ad
    const publicAds = await get('/api/ads/races/race-1');
    const pair = publicAds.body.data.ads.find(a => a.id === adId);
    expect(pair).toBeTruthy();
    expect(pair.rebuttals.some(r => r.id === rebId)).toBe(true);
  });
});

describe('uploaded media paths', () => {
  it('ads accept platform media paths returned by the upload API (not just absolute URLs)', async () => {
    const staff = await registerUser('mediapath');
    await env.ARENA_DB.batch([
      env.ARENA_DB.prepare(`INSERT OR IGNORE INTO candidate_staff_links (id, user_id, candidate_id, role, is_active) VALUES (?, ?, 'cand-3', 'primary', 1)`).bind(`pw-media-${staff.id}`, staff.id),
      env.ARENA_DB.prepare(`UPDATE candidates SET verification_status = 'verified' WHERE id = 'cand-3'`),
    ]);
    const cand = await env.ARENA_DB.prepare(`SELECT race_id FROM candidates WHERE id = 'cand-3'`).first();
    const res = await post('/api/ads', {
      race_id: cand.race_id,
      candidate_id: 'cand-3',
      title: 'Uploaded media path ad',
      ad_content_text: 'Regression: relative platform media paths must validate.',
      disclaimer_text: 'Paid for by Test Committee.',
      media_url: '/media/uploads/cand-3/media_regression.mp4',
      media_type: 'video',
    }, staff.token);
    expect(res.status).toBe(200);

    const bad = await post('/api/ads', {
      race_id: cand.race_id,
      candidate_id: 'cand-3',
      title: 'Bad media path ad',
      ad_content_text: 'Relative paths outside the platform prefixes must still fail.',
      disclaimer_text: 'Paid for by Test Committee.',
      media_url: 'not-a-url-or-platform-path',
      media_type: 'video',
    }, staff.token);
    expect(bad.status).toBe(400);
  });
});

describe('rate limits', () => {
  it('forgot-password is limited per email', async () => {
    const user = await registerUser('forgotlimit');
    for (let i = 0; i < 3; i++) {
      const res = await post('/api/auth/forgot-password', { email: user.email });
      expect(res.status).toBe(200);
    }
    const limited = await post('/api/auth/forgot-password', { email: user.email });
    expect(limited.status).toBe(429);
  });
});
