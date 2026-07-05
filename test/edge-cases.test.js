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

async function put(path, body, token) {
  return request('PUT', path, body, token);
}

async function get(path, token) {
  return request('GET', path, undefined, token);
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

  it('requires sourced recites for fact-check callouts and attaches them to the challenge', async () => {
    const staff = await registerUser('factstaff');
    const targetStaff = await registerUser('facttarget');
    const suffix = Date.now().toString(36);
    const raceId = `edge-fact-race-${suffix}`;
    const challengerId = `edge-fact-a-${suffix}`;
    const targetId = `edge-fact-b-${suffix}`;

    await env.ARENA_DB.batch([
      env.ARENA_DB.prepare(
        `INSERT INTO races (id, name, office, state, district, status)
         VALUES (?, ?, 'House', 'AL', '88', 'active')`
      ).bind(raceId, `Edge Fact Race ${suffix}`),
      env.ARENA_DB.prepare(
        `INSERT INTO candidates (id, race_id, user_id, name, party, verification_status, credit_balance, is_active)
         VALUES (?, ?, ?, 'Fact Challenger', 'Independent', 'verified', 5, 1)`
      ).bind(challengerId, raceId, staff.id),
      env.ARENA_DB.prepare(
        `INSERT INTO candidates (id, race_id, user_id, name, party, verification_status, credit_balance, is_active)
         VALUES (?, ?, 'system', 'Fact Target', 'Independent', 'verified', 5, 1)`
      ).bind(targetId, raceId),
      env.ARENA_DB.prepare(
        `INSERT INTO candidate_staff_links (id, user_id, candidate_id, role, is_active)
         VALUES (?, ?, ?, 'primary', 1)`
      ).bind(`edge-fact-link-${suffix}`, staff.id, challengerId),
      env.ARENA_DB.prepare(
        `INSERT INTO candidate_staff_links (id, user_id, candidate_id, role, is_active)
         VALUES (?, ?, ?, 'primary', 1)`
      ).bind(`edge-fact-target-link-${suffix}`, targetStaff.id, targetId),
    ]);

    const unsupported = await post('/api/challenges', {
      race_id: raceId,
      challenger_candidate_id: challengerId,
      target_candidate_id: targetId,
      challenge_type: 'fact_check',
      claim_text: 'The city budget doubled last year.',
      challenge_text: 'You claimed the city budget doubled, but the public filings do not show that.',
    }, staff.token);
    expect(unsupported.status).toBe(400);

    const balanceAfterRejectedCallout = await env.ARENA_DB.prepare(
      `SELECT credit_balance FROM candidates WHERE id = ?`
    ).bind(challengerId).first();
    expect(balanceAfterRejectedCallout.credit_balance).toBe(5);

    const sourced = await post('/api/challenges', {
      race_id: raceId,
      challenger_candidate_id: challengerId,
      target_candidate_id: targetId,
      challenge_type: 'fact_check',
      claim_text: 'The city budget doubled last year.',
      challenge_text: 'You claimed the city budget doubled, but the public filings do not show that.',
      dispute_summary: 'The cited public filing lists a smaller year-over-year increase.',
      requested_response: 'Please identify the budget line that doubled.',
      initial_recites: [{
        url: `https://example.com/budget-filing-${suffix}`,
        title: 'City budget filing',
        publisher: 'City Clerk',
        source_type: 'official_record',
        source_published_at: '2026-01-15',
        accessed_at: '2026-07-05',
        archive_url: `https://example.com/archive/budget-filing-${suffix}`,
        quote: 'The filing shows the budget amount for the relevant fiscal year.',
      }],
    }, staff.token);
    expect(sourced.status).toBe(200);
    expect(sourced.body.data.initial_recites).toBe(1);

    const recites = await get(`/api/recites?content_type=challenge&content_id=${sourced.body.data.id}`);
    expect(recites.status).toBe(200);
    expect(recites.body.data.recites).toHaveLength(1);
    expect(recites.body.data.recites[0].title).toBe('City budget filing');
    expect(recites.body.data.recites[0].archive_url).toContain('/archive/');
    expect(recites.body.data.recites[0].accessed_at).toBe('2026-07-05');
    expect(recites.body.data.fact_score.score).toBeGreaterThan(50);

    const receipt = await get(`/api/challenges/${sourced.body.data.public_receipt_slug}/receipt`);
    expect(receipt.status).toBe(200);
    expect(receipt.body.data.challenge.claim_text).toBe('The city budget doubled last year.');
    expect(receipt.body.data.recites).toHaveLength(1);

    const notification = await env.ARENA_DB.prepare(
      `SELECT notification_type, link_url FROM notifications WHERE user_id = ? AND notification_type = 'challenge_tagged' ORDER BY created_at DESC LIMIT 1`
    ).bind(targetStaff.id).first();
    expect(notification.notification_type).toBe('challenge_tagged');
    expect(notification.link_url).toBe(`/challenge/${sourced.body.data.public_receipt_slug}`);
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

  it('scores source-backed recites and requires admin review for verification', async () => {
    const voter = await makeVerifiedVoter('recitevoter');
    const admin = await makeAdmin('reciteadmin');
    const suffix = Date.now().toString(36);

    const invalidTarget = await post('/api/recites', {
      content_type: 'ad',
      content_id: 'ad-does-not-exist',
      url: `https://example.com/recites/missing-${suffix}`,
      title: 'Missing target source',
      source_type: 'official_record',
      stance: 'supports',
    }, voter.token);
    expect(invalidTarget.status).toBe(404);

    const invalidType = await get('/api/recites?content_type=junk&content_id=ad-1');
    expect(invalidType.status).toBe(400);

    const missingScore = await get('/api/recites?content_type=ad&content_id=ad-does-not-exist');
    expect(missingScore.status).toBe(404);

    const created = await post('/api/recites', {
      content_type: 'ad',
      content_id: 'ad-1',
      url: `https://example.com/recites/official-${suffix}`,
      title: 'Official budget filing',
      publisher: 'State Elections Office',
      source_type: 'official_record',
      stance: 'supports',
      quote: 'The filing shows the cited budget amount.',
    }, voter.token);
    expect(created.status).toBe(200);
    expect(created.body.data.status).toBe('pending');

    const duplicate = await post('/api/recites', {
      content_type: 'ad',
      content_id: 'ad-1',
      url: `https://example.com/recites/official-${suffix}`,
      title: 'Official budget filing',
      source_type: 'official_record',
      stance: 'supports',
    }, voter.token);
    expect(duplicate.status).toBe(409);

    const notReviewer = await put(`/api/recites/${created.body.data.id}/review`, {
      status: 'verified',
    }, voter.token);
    expect(notReviewer.status).toBe(403);

    const pendingScore = await get('/api/recites?content_type=ad&content_id=ad-1');
    expect(pendingScore.status).toBe(200);
    expect(pendingScore.body.data.recites.some(item => item.id === created.body.data.id)).toBe(true);
    expect(pendingScore.body.data.fact_score.pending_count).toBeGreaterThanOrEqual(1);
    expect(pendingScore.body.data.fact_score.score).toBeGreaterThan(50);

    const queue = await get('/api/recites/pending?status=pending', admin.token);
    expect(queue.status).toBe(200);
    expect(queue.body.data.recites.some(item => item.id === created.body.data.id)).toBe(true);

    const reviewed = await put(`/api/recites/${created.body.data.id}/review`, {
      status: 'verified',
      review_note: 'Official source checked.',
    }, admin.token);
    expect(reviewed.status).toBe(200);

    const reviewedRow = await env.ARENA_DB.prepare(
      `SELECT review_note FROM recites WHERE id = ?`
    ).bind(created.body.data.id).first();
    expect(reviewedRow.review_note).toBe('Official source checked.');

    const verifiedScore = await get('/api/recites?content_type=ad&content_id=ad-1');
    expect(verifiedScore.status).toBe(200);
    expect(verifiedScore.body.data.fact_score.verified_count).toBeGreaterThanOrEqual(1);
    expect(verifiedScore.body.data.fact_score.label).toBe('source-supported');
  });

  it('logs timestamped statements and reflects review data on public candidate profiles', async () => {
    const staff = await registerUser('statementstaff');
    const admin = await makeAdmin('statementadmin');
    const suffix = Date.now().toString(36);
    const raceId = `edge-stmt-race-${suffix}`;
    const candidateId = `edge-stmt-cand-${suffix}`;

    await env.ARENA_DB.batch([
      env.ARENA_DB.prepare(
        `INSERT INTO races (id, name, office, state, district, status)
         VALUES (?, ?, 'House', 'AL', '55', 'active')`
      ).bind(raceId, `Statement Race ${suffix}`),
      env.ARENA_DB.prepare(
        `INSERT INTO candidates (id, race_id, user_id, name, party, verification_status, credit_balance, is_active)
         VALUES (?, ?, ?, 'Statement Candidate', 'Independent', 'verified', 5, 1)`
      ).bind(candidateId, raceId, staff.id),
      env.ARENA_DB.prepare(
        `INSERT INTO candidate_staff_links (id, user_id, candidate_id, role, is_active)
         VALUES (?, ?, ?, 'primary', 1)`
      ).bind(`edge-stmt-link-${suffix}`, staff.id, candidateId),
    ]);

    const created = await post('/api/statements', {
      candidate_id: candidateId,
      race_id: raceId,
      statement_text: 'We reduced property taxes by ten percent.',
      question_text: 'What did you do on taxes?',
      response_text: 'We reduced property taxes by ten percent.',
      topic: 'Taxes',
      source_type: 'youtube',
      source_url: `https://www.youtube.com/watch?v=stmt${suffix}`,
      source_title: 'Town hall tax answer',
      transcript_url: `https://example.com/transcripts/stmt-${suffix}`,
      quote_start_seconds: 61,
      quote_end_seconds: 75,
      statement_at: '2026-06-01T12:00:00Z',
    }, staff.token);
    expect(created.status).toBe(200);
    expect(created.body.data.claim_key).toContain('reduced');

    const reviewed = await put(`/api/statements/${created.body.data.id}/review`, {
      truth_status: 'disputed',
      answer_status: 'partial',
      evasion_score: 45,
      confidence_score: 80,
      review_note: 'Answer partially addressed the question.',
    }, admin.token);
    expect(reviewed.status).toBe(200);

    const profile = await get(`/api/candidates/${candidateId}/public-profile`);
    expect(profile.status).toBe(200);
    expect(profile.body.data.stats.statements).toBe(1);
    expect(profile.body.data.trust.avg_evasion_score).toBe(45);
    expect(profile.body.data.recent_statements[0].truth_status).toBe('disputed');

    const search = await get('/api/statements/search?q=property%20taxes');
    expect(search.status).toBe(200);
    expect(search.body.data.statements.some(item => item.id === created.body.data.id)).toBe(true);
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
