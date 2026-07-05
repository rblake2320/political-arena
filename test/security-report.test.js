/**
 * Security regression tests for red-team findings.
 * Runs against the real Worker, D1, and local R2 bindings.
 */
import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'https://example.com';
const VALID_PASSWORD = 'Str0ng!Passw0rd';
const NEW_PASSWORD = 'N3w!Passw0rd';
let seq = 0;

async function api(method, path, body, token, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  const init = { method, headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await SELF.fetch(`${BASE}${path}`, init);
  const contentType = res.headers.get('Content-Type') || '';
  const parsed = contentType.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, headers: res.headers, body: parsed };
}

async function post(path, body, token, headers) {
  return api('POST', path, body, token, headers);
}

async function get(path, token, headers) {
  return api('GET', path, undefined, token, headers);
}

async function registerUser(label) {
  seq += 1;
  const suffix = `${Date.now().toString(36)}${seq}`;
  const res = await post('/api/auth/register', {
    email: `${label}-${suffix}@example.com`,
    username: `sec_${label}_${seq}`.slice(0, 30),
    password: VALID_PASSWORD,
    display_name: `Security ${label}`,
  });
  expect(res.status).toBe(200);
  return { token: res.body.data.token, id: res.body.data.user.id, email: res.body.data.user.email };
}

async function makeVerifiedVoter(label) {
  const user = await registerUser(label);
  await env.ARENA_DB.prepare(
    `UPDATE users SET verification_status = 'verified', email_verified = 1 WHERE id = ?`
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
  ).bind(`sec-link-${userId}-${candidateId}`, userId, candidateId, role).run();
}

describe('red-team report regressions', () => {
  beforeAll(async () => {
    await SELF.fetch(`${BASE}/api/health`);
  });

  it('adds HSTS to API responses', async () => {
    const res = await get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('Strict-Transport-Security')).toMatch(/max-age=31536000/);
  });

  it('strips analytics user impersonation and caps metadata', async () => {
    const actor = await registerUser('analyticsactor');
    const victim = await registerUser('analyticsvictim');
    const marker = `security.analytics.${Date.now()}`;

    const res = await post('/api/analytics/events', {
      events: [{
        event_type: marker,
        user_id: victim.id,
        session_id: 'fake-session-id',
        metadata: { blob: 'x'.repeat(1500) },
      }],
    }, actor.token, { 'CF-Connecting-IP': '203.0.113.10' });

    expect(res.status).toBe(200);
    const row = await env.ARENA_DB.prepare(
      `SELECT user_id, session_id, metadata FROM analytics_events WHERE event_type = ? ORDER BY created_at DESC LIMIT 1`
    ).bind(marker).first();
    expect(row.user_id).toBe(actor.id);
    expect(row.user_id).not.toBe(victim.id);
    expect(row.session_id).not.toBe('fake-session-id');
    expect(row.metadata.length).toBeLessThanOrEqual(1000);
  });

  it('accepts event_data as a compatibility alias for analytics metadata', async () => {
    const marker = `security.analytics.alias.${Date.now()}`;

    const res = await post('/api/analytics/events', {
      events: [{
        event_type: marker,
        race_id: 'race-1',
        content_type: 'race',
        content_id: 'race-1',
        event_data: { route: '/race/:id', path: '/race/race-1' },
      }],
    }, undefined, { 'CF-Connecting-IP': '203.0.113.13' });

    expect(res.status).toBe(200);
    const row = await env.ARENA_DB.prepare(
      `SELECT race_id, content_type, content_id, metadata FROM analytics_events WHERE event_type = ? ORDER BY created_at DESC LIMIT 1`
    ).bind(marker).first();
    expect(row.race_id).toBe('race-1');
    expect(row.content_type).toBe('race');
    expect(row.content_id).toBe('race-1');
    expect(JSON.parse(row.metadata)).toEqual({ route: '/race/:id', path: '/race/race-1' });
  });

  it('rate-limits analytics ingestion by IP', async () => {
    const ip = '203.0.113.11';
    let last;
    for (let i = 0; i < 31; i++) {
      last = await post('/api/analytics/events', { events: [] }, undefined, { 'CF-Connecting-IP': ip });
    }
    expect(last.status).toBe(429);
  });

  it('supports password reset with hashed token storage and session invalidation', async () => {
    const user = await registerUser('resetuser');

    const forgot = await post('/api/auth/forgot-password', { email: user.email });
    expect(forgot.status).toBe(200);
    const resetRow = await env.ARENA_DB.prepare(
      `SELECT password_reset_token_hash, password_reset_expires_at FROM users WHERE id = ?`
    ).bind(user.id).first();
    expect(resetRow.password_reset_token_hash).toBeTruthy();
    expect(resetRow.password_reset_token_hash).not.toBe(user.email);
    expect(resetRow.password_reset_expires_at).toBeTruthy();
    expect(forgot.body.data.dev_reset_token).toBeTruthy();
    expect(forgot.body.data.reset_url).toContain('/reset-password?token=');

    const reset = await post('/api/auth/reset-password', { token: forgot.body.data.dev_reset_token, password: NEW_PASSWORD });
    expect(reset.status).toBe(200);

    const oldSession = await get('/api/auth/me', user.token);
    expect(oldSession.status).toBe(401);

    const oldLogin = await post('/api/auth/login', { email: user.email, password: VALID_PASSWORD });
    expect(oldLogin.status).toBe(401);

    const newLogin = await post('/api/auth/login', { email: user.email, password: NEW_PASSWORD });
    expect(newLogin.status).toBe(200);

    const cleared = await env.ARENA_DB.prepare(
      `SELECT password_reset_token_hash, password_reset_expires_at FROM users WHERE id = ?`
    ).bind(user.id).first();
    expect(cleared.password_reset_token_hash).toBeNull();
    expect(cleared.password_reset_expires_at).toBeNull();
  });

  it('rate-limits email verification attempts by IP', async () => {
    const ip = '203.0.113.12';
    let last;
    for (let i = 0; i < 6; i++) {
      last = await post('/api/auth/verify-email', { token: `invalid-${i}` }, undefined, { 'CF-Connecting-IP': ip });
    }
    expect(last.status).toBe(429);
  });

  it('prevents non-admin primary staff grants', async () => {
    const primary = await registerUser('primarygrant');
    const target = await registerUser('primarytarget');
    await linkStaff(primary.id, 'cand-1', 'primary');

    const res = await post('/api/candidates/cand-1/staff', {
      user_id: target.id,
      role: 'primary',
    }, primary.token);

    expect(res.status).toBe(403);
  });

  it('keeps platform admin separate from campaign authority', async () => {
    const admin = await makeAdmin('campaignboundary');

    const ad = await post('/api/ads', {
      race_id: 'race-1',
      candidate_id: 'cand-1',
      title: 'Admin should not be campaign staff',
      ad_content_text: 'This should require a real campaign staff link.',
      disclaimer_text: 'Paid for by Candidate',
    }, admin.token);
    expect(ad.status).toBe(403);

    const challenge = await post('/api/challenges', {
      race_id: 'race-1',
      challenger_candidate_id: 'cand-1',
      target_candidate_id: 'cand-2',
      challenge_text: 'Please explain this policy in detail.',
      challenge_type: 'policy_question',
    }, admin.token);
    expect(challenge.status).toBe(403);

    const statement = await post('/api/statements', {
      candidate_id: 'cand-1',
      race_id: 'race-1',
      statement_text: 'This statement should not be logged by platform admin authority alone.',
      source_url: 'https://example.com/admin-boundary-source',
      source_type: 'article',
    }, admin.token);
    expect(statement.status).toBe(403);
  });

  it('returns the persisted balance after credit grants', async () => {
    const admin = await makeAdmin('creditadmin');
    const res = await post('/api/credits/cand-1/grant', {
      amount: 7,
      description: 'security regression grant',
    }, admin.token);
    expect(res.status).toBe(200);

    const row = await env.ARENA_DB.prepare(
      `SELECT credit_balance FROM candidates WHERE id = 'cand-1'`
    ).first();
    expect(res.body.data.credit_balance).toBe(row.credit_balance);
  });

  it('records media uploads for O(1) serve lookup', async () => {
    const staff = await registerUser('mediaupload');
    await linkStaff(staff.id, 'cand-1');

    const presign = await post('/api/uploads/presign', {
      filename: 'proof.png',
      content_type: 'image/png',
      candidate_id: 'cand-1',
    }, staff.token);
    expect(presign.status).toBe(200);

    const form = new FormData();
    form.append('file', new File(['fake png'], 'proof.png', { type: 'image/png' }));
    form.append('key', presign.body.data.key);
    form.append('candidate_id', 'cand-1');
    const upload = await SELF.fetch(`${BASE}/api/uploads/direct`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${staff.token}` },
      body: form,
    });
    expect(upload.status).toBe(200);

    const stored = await env.ARENA_DB.prepare(
      `SELECT key FROM media_uploads WHERE file_id = ?`
    ).bind(presign.body.data.file_id).first();
    expect(stored.key).toBe(presign.body.data.key);

    const served = await SELF.fetch(`${BASE}/api/uploads/serve/${presign.body.data.file_id}`);
    expect(served.status).toBe(200);
    expect(new TextDecoder().decode(await served.arrayBuffer())).toBe('fake png');
  });

  it('accepts mobile media uploads with inferred types and serves byte ranges', async () => {
    const staff = await registerUser('mobilemedia');
    await linkStaff(staff.id, 'cand-1');

    const info = await get('/api/uploads/info', staff.token);
    expect(info.status).toBe(200);
    const supported = info.body.data.supported_types.map(type => type.mime);
    expect(supported).toContain('video/quicktime');
    expect(supported).toContain('audio/mp4');
    expect(supported).toContain('image/heic');

    const audioPresign = await post('/api/uploads/presign', {
      filename: 'voice-note.m4a',
      content_type: 'audio/x-m4a',
      candidate_id: 'cand-1',
    }, staff.token);
    expect(audioPresign.status).toBe(200);
    expect(audioPresign.body.data.content_type).toBe('audio/mp4');
    expect(audioPresign.body.data.key).toMatch(/\.m4a$/);

    const presign = await post('/api/uploads/presign', {
      filename: 'phone-video.mov',
      content_type: '',
      candidate_id: 'cand-1',
    }, staff.token);
    expect(presign.status).toBe(200);
    expect(presign.body.data.content_type).toBe('video/quicktime');
    expect(presign.body.data.media_kind).toBe('video');
    expect(presign.body.data.key).toMatch(/\.mov$/);

    const form = new FormData();
    form.append('file', new File(['phone-video-data'], 'phone-video.mov', { type: '' }));
    form.append('key', presign.body.data.key);
    form.append('candidate_id', 'cand-1');

    const upload = await SELF.fetch(`${BASE}/api/uploads/direct`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${staff.token}` },
      body: form,
    });
    expect(upload.status).toBe(200);
    const uploadBody = await upload.json();
    expect(uploadBody.data.type).toBe('video/quicktime');
    expect(uploadBody.data.media_kind).toBe('video');

    const ranged = await SELF.fetch(`${BASE}/media/${presign.body.data.key}`, {
      headers: { Range: 'bytes=0-4' },
    });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('Accept-Ranges')).toBe('bytes');
    expect(ranged.headers.get('Content-Range')).toBe('bytes 0-4/16');
    expect(ranged.headers.get('Content-Type')).toBe('video/quicktime');
    expect(new TextDecoder().decode(await ranged.arrayBuffer())).toBe('phone');
  });

  it('rate-limits question vote toggles per user', async () => {
    const voter = await makeVerifiedVoter('voteratelimit');
    const questionId = `sec-q-${Date.now()}`;
    await env.ARENA_DB.prepare(
      `INSERT INTO questions (id, race_id, user_id, source_type, question_text)
       VALUES (?, 'race-1', ?, 'voter', 'Should this race include another debate?')`
    ).bind(questionId, voter.id).run();

    let last;
    for (let i = 0; i < 21; i++) {
      last = await post(`/api/questions/${questionId}/vote`, {}, voter.token);
    }
    expect(last.status).toBe(429);
  });

  it('rejects junk reaction count content types', async () => {
    const res = await get('/api/reactions/counts?content_type=junk&content_id=ad-1');
    expect(res.status).toBe(400);
  });

  it('rejects oversized survey response arrays', async () => {
    const voter = await makeVerifiedVoter('surveyoversize');
    const responses = Array.from({ length: 101 }, (_, i) => ({
      question_id: `q-${i}`,
      response_value: 'yes',
    }));

    const res = await post('/api/surveys/survey-does-not-matter/respond', { responses }, voter.token);
    expect(res.status).toBe(400);
  });

  it('rejects cross-survey response injection and upserts one answer per voter question', async () => {
    const voter = await makeVerifiedVoter('surveyintegrity');
    const suffix = Date.now().toString(36);
    const surveyA = `sec-survey-a-${suffix}`;
    const surveyB = `sec-survey-b-${suffix}`;
    const questionA = `sec-question-a-${suffix}`;
    const questionB = `sec-question-b-${suffix}`;

    await env.ARENA_DB.batch([
      env.ARENA_DB.prepare(
        `INSERT INTO surveys (id, title, status, created_by, target_audience)
         VALUES (?, 'Security Survey A', 'active', ?, 'all')`
      ).bind(surveyA, voter.id),
      env.ARENA_DB.prepare(
        `INSERT INTO surveys (id, title, status, created_by, target_audience)
         VALUES (?, 'Security Survey B', 'active', ?, 'all')`
      ).bind(surveyB, voter.id),
      env.ARENA_DB.prepare(
        `INSERT INTO survey_questions (id, survey_id, question_text, question_type)
         VALUES (?, ?, 'Question A?', 'multiple_choice')`
      ).bind(questionA, surveyA),
      env.ARENA_DB.prepare(
        `INSERT INTO survey_questions (id, survey_id, question_text, question_type)
         VALUES (?, ?, 'Question B?', 'multiple_choice')`
      ).bind(questionB, surveyB),
    ]);

    const injected = await post(`/api/surveys/${surveyA}/respond`, {
      responses: [{ question_id: questionB, response_value: 'yes' }],
    }, voter.token);
    expect(injected.status).toBe(400);

    const duplicatePayload = await post(`/api/surveys/${surveyA}/respond`, {
      responses: [
        { question_id: questionA, response_value: 'yes' },
        { question_id: questionA, response_value: 'no' },
      ],
    }, voter.token);
    expect(duplicatePayload.status).toBe(400);

    const first = await post(`/api/surveys/${surveyA}/respond`, {
      responses: [{ question_id: questionA, response_value: 'yes' }],
    }, voter.token);
    expect(first.status).toBe(200);

    const second = await post(`/api/surveys/${surveyA}/respond`, {
      responses: [{ question_id: questionA, response_value: 'no' }],
    }, voter.token);
    expect(second.status).toBe(200);

    const count = await env.ARENA_DB.prepare(
      `SELECT COUNT(*) as count FROM voter_survey_responses WHERE user_id = ? AND survey_id = ? AND question_id = ?`
    ).bind(voter.id, surveyA, questionA).first();
    expect(count.count).toBe(1);

    const row = await env.ARENA_DB.prepare(
      `SELECT response_value FROM voter_survey_responses WHERE user_id = ? AND survey_id = ? AND question_id = ?`
    ).bind(voter.id, surveyA, questionA).first();
    expect(row.response_value).toBe('no');
  });

  it('validates candidate verification actions before changing status', async () => {
    const admin = await makeAdmin('candidateverifyadmin');
    const candidateId = `sec-verify-cand-${Date.now().toString(36)}`;
    await env.ARENA_DB.prepare(
      `INSERT INTO candidates (id, race_id, name, party, verification_status, is_active)
       VALUES (?, 'race-1', 'Verification Candidate', 'Independent', 'pending', 1)`
    ).bind(candidateId).run();

    const nullAction = await post(`/api/candidates/${candidateId}/verify`, null, admin.token);
    expect(nullAction.status).toBe(400);

    const typoAction = await post(`/api/candidates/${candidateId}/verify`, { action: 'typo' }, admin.token);
    expect(typoAction.status).toBe(400);

    const unchanged = await env.ARENA_DB.prepare(
      `SELECT verification_status FROM candidates WHERE id = ?`
    ).bind(candidateId).first();
    expect(unchanged.verification_status).toBe('pending');

    const verified = await post(`/api/candidates/${candidateId}/verify`, { action: 'verify' }, admin.token);
    expect(verified.status).toBe(200);
    expect(verified.body.data.verification_status).toBe('verified');

    const rejected = await post(`/api/candidates/${candidateId}/verify`, { action: 'reject' }, admin.token);
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.verification_status).toBe('rejected');
  });

  it('limits challenge notification fan-out to 500 subscribers', async () => {
    const staff = await registerUser('fanoutstaff');
    await linkStaff(staff.id, 'cand-5');
    const marker = `Fanout ${Date.now()}`;

    const inserts = [];
    for (let i = 0; i < 501; i++) {
      inserts.push(env.ARENA_DB.prepare(
        `INSERT INTO notification_subscriptions (id, user_id, subscription_type, target_id, notify_on, channel, is_active)
         VALUES (?, 'system', 'race', 'race-3', '[]', 'in_app', 1)`
      ).bind(`sec-fanout-${Date.now()}-${i}`));
    }
    for (let i = 0; i < inserts.length; i += 50) {
      await env.ARENA_DB.batch(inserts.slice(i, i + 50));
    }

    const res = await post('/api/challenges', {
      race_id: 'race-3',
      challenger_candidate_id: 'cand-5',
      target_candidate_id: 'cand-6',
      challenge_text: `${marker}: Please explain your housing plan with implementation details.`,
      challenge_type: 'policy_question',
    }, staff.token);
    expect(res.status).toBe(200);

    const expectedBody = `${marker}: Please explain your housing plan with implementation details.`;
    const notifications = await env.ARENA_DB.prepare(
      `SELECT COUNT(*) as count FROM notifications WHERE body = ?`
    ).bind(expectedBody).first();
    expect(notifications.count).toBe(500);
  });
});
