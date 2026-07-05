/**
 * Edge-case integration tests — real worker, real D1/R2 bindings.
 * Covers controlled failures for invalid state transitions, bad references,
 * duplicate ranking input, and upload ownership mismatches.
 */
import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'https://example.com';
const VALID_PASSWORD = 'Str0ng!Passw0rd';
let seq = 0;

async function request(method, path, body, token) {
  const headers = {};
  const init = { method, headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await SELF.fetch(`${BASE}${path}`, init);
  return { status: res.status, body: await res.json() };
}

async function post(path, body, token) {
  return request('POST', path, body, token);
}

async function registerUser(label) {
  seq += 1;
  const suffix = `${Date.now().toString(36)}${seq}`;
  const username = `edge_${label}_${seq}`.slice(0, 30);
  const res = await post('/api/auth/register', {
    email: `${label}-${suffix}@example.com`,
    username,
    password: VALID_PASSWORD,
    display_name: `Edge ${label}`,
  });
  expect(res.status).toBe(200);
  return { token: res.body.data.token, id: res.body.data.user.id, username };
}

async function makeVerifiedVoter(label) {
  const user = await registerUser(label);
  await env.ARENA_DB.prepare(
    `UPDATE users
     SET verification_status = 'verified', email_verified = 1, party_affiliation = 'Democrat'
     WHERE id = ?`
  ).bind(user.id).run();
  return user;
}

async function makeAdmin(label) {
  const user = await registerUser(label);
  await env.ARENA_DB.prepare(
    `UPDATE users SET role = 'admin', verification_status = 'verified', email_verified = 1 WHERE id = ?`
  ).bind(user.id).run();
  return user;
}

async function linkStaff(userId, candidateId, role = 'primary') {
  await env.ARENA_DB.prepare(
    `INSERT OR IGNORE INTO candidate_staff_links (id, user_id, candidate_id, role, is_active)
     VALUES (?, ?, ?, ?, 1)`
  ).bind(`edge-link-${userId}-${candidateId}`, userId, candidateId, role).run();
}

describe('edge-case regressions', () => {
  beforeAll(async () => {
    await SELF.fetch(`${BASE}/api/health`);
  });

  it('rejects invalid candidate staff roles without creating a link', async () => {
    const primary = await registerUser('primary');
    const target = await registerUser('target');
    await linkStaff(primary.id, 'cand-1');

    const res = await post('/api/candidates/cand-1/staff', {
      user_id: target.id,
      role: 'owner',
    }, primary.token);

    expect(res.status).toBe(400);
    const link = await env.ARENA_DB.prepare(
      `SELECT id FROM candidate_staff_links WHERE user_id = ? AND candidate_id = 'cand-1'`
    ).bind(target.id).first();
    expect(link).toBeNull();
  });

  it('returns 404 when adding staff to a missing candidate', async () => {
    const admin = await makeAdmin('adminstaff');
    const target = await registerUser('staffmissing');

    const res = await post('/api/candidates/not-a-real-candidate/staff', {
      user_id: target.id,
      role: 'staff',
    }, admin.token);

    expect(res.status).toBe(404);
  });

  it('validates challenge refusal bodies and preserves open challenges on failure', async () => {
    const targetStaff = await registerUser('targetstaff');
    await linkStaff(targetStaff.id, 'cand-2');

    const challengeId = `edge-chal-${Date.now().toString(36)}`;
    await env.ARENA_DB.prepare(
      `INSERT INTO challenges
       (id, race_id, challenger_candidate_id, target_candidate_id, created_by, challenge_text, challenge_type, status, deadline_business_days, response_deadline)
       VALUES (?, 'race-1', 'cand-1', 'cand-2', 'system', 'Explain this policy position in detail.', 'policy_question', 'open', 3, ?)`
    ).bind(challengeId, new Date(Date.now() + 86400000).toISOString()).run();

    const res = await post(`/api/challenges/${challengeId}/refuse`, {
      refusal_reason: 'x'.repeat(1001),
    }, targetStaff.token);

    expect(res.status).toBe(400);
    const row = await env.ARENA_DB.prepare(
      `SELECT status FROM challenges WHERE id = ?`
    ).bind(challengeId).first();
    expect(row.status).toBe('open');
  });

  it('rejects duplicate priority ranks and unknown issue categories', async () => {
    const voter = await makeVerifiedVoter('priorityvoter');

    const duplicateRank = await post('/api/surveys/my-priorities', {
      priorities: [
        { issue_category_id: 'cat-1', priority_rank: 1 },
        { issue_category_id: 'cat-2', priority_rank: 1 },
      ],
    }, voter.token);
    expect(duplicateRank.status).toBe(400);

    const unknownCategory = await post('/api/surveys/my-priorities', {
      priorities: [{ issue_category_id: 'cat-does-not-exist', priority_rank: 1 }],
    }, voter.token);
    expect(unknownCategory.status).toBe(400);

    const valid = await post('/api/surveys/my-priorities', {
      priorities: [
        { issue_category_id: 'cat-1', priority_rank: 1 },
        { issue_category_id: 'cat-2', priority_rank: 2 },
      ],
    }, voter.token);
    expect(valid.status).toBe(200);
    expect(valid.body.data.saved).toBe(2);
  });

  it('rejects subscriptions to missing targets and keeps duplicate detection', async () => {
    const user = await registerUser('subscriber');

    const missing = await post('/api/notifications/subscribe', {
      subscription_type: 'candidate',
      target_id: 'cand-does-not-exist',
    }, user.token);
    expect(missing.status).toBe(404);

    const created = await post('/api/notifications/subscribe', {
      subscription_type: 'race',
      target_id: 'race-1',
    }, user.token);
    expect(created.status).toBe(200);

    const duplicate = await post('/api/notifications/subscribe', {
      subscription_type: 'race',
      target_id: 'race-1',
    }, user.token);
    expect(duplicate.status).toBe(409);
  });

  it('rejects reactions to missing content and accepts visible content', async () => {
    const voter = await makeVerifiedVoter('reactionvoter');

    const missing = await post('/api/reactions', {
      content_type: 'ad',
      content_id: 'ad-does-not-exist',
      reaction_type: 'helpful',
    }, voter.token);
    expect(missing.status).toBe(404);

    const created = await post('/api/reactions', {
      content_type: 'ad',
      content_id: 'ad-1',
      reaction_type: 'helpful',
    }, voter.token);
    expect(created.status).toBe(200);

    const duplicate = await post('/api/reactions', {
      content_type: 'ad',
      content_id: 'ad-1',
      reaction_type: 'helpful',
    }, voter.token);
    expect(duplicate.status).toBe(409);
  });

  it('rejects direct uploads when the key owner and candidate metadata differ', async () => {
    const staff = await registerUser('uploader');
    await linkStaff(staff.id, 'cand-1');

    const presign = await post('/api/uploads/presign', {
      filename: 'proof.png',
      content_type: 'image/png',
    }, staff.token);
    expect(presign.status).toBe(200);

    const form = new FormData();
    form.append('file', new File(['fake png'], 'proof.png', { type: 'image/png' }));
    form.append('key', presign.body.data.key);
    form.append('candidate_id', 'cand-1');

    const res = await SELF.fetch(`${BASE}/api/uploads/direct`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${staff.token}` },
      body: form,
    });
    expect(res.status).toBe(403);
  });
});
