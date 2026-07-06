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

  it('seeds neutral public issue categories for democracy and reproductive policy', async () => {
    const res = await get('/api/surveys/issue-categories');

    expect(res.status).toBe(200);
    const categoriesBySlug = Object.fromEntries(
      res.body.data.categories.map(category => [category.slug, category])
    );
    expect(categoriesBySlug['elections-democracy'].name).toBe('Elections and Democracy');
    expect(categoriesBySlug['elections-democracy'].description).toBe('Voting rights, election administration, election integrity');
    expect(categoriesBySlug['reproductive-policy'].name).toBe('Abortion and Reproductive Policy');
    expect(categoriesBySlug['reproductive-policy'].description).toBe('Abortion, contraception, reproductive health policy');
    expect(categoriesBySlug['cost-of-living'].name).toBe('Cost of Living');
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

    const response = await post(`/api/challenges/${sourced.body.data.id}/respond`, {
      response_text: 'The campaign response cites the relevant budget line and adds context for voters.',
    }, targetStaff.token);
    expect(response.status).toBe(200);

    const receipt = await get(`/api/challenges/${sourced.body.data.public_receipt_slug}/receipt`);
    expect(receipt.status).toBe(200);
    expect(receipt.body.data.challenge.claim_text).toBe('The city budget doubled last year.');
    expect(receipt.body.data.recites).toHaveLength(1);
    expect(receipt.body.data.audit_chain.status).toBe('verified');
    expect(receipt.body.data.audit_chain.checked_entries).toBeGreaterThanOrEqual(2);
    expect(receipt.body.data.timeline.map(entry => entry.chain_seq)).toEqual([1, 2]);
    expect(receipt.body.data.timeline[0].entry_hash).toMatch(/^[a-f0-9]{64}$/);

    const notification = await env.ARENA_DB.prepare(
      `SELECT notification_type, link_url FROM notifications WHERE user_id = ? AND notification_type = 'challenge_tagged' ORDER BY created_at DESC LIMIT 1`
    ).bind(targetStaff.id).first();
    expect(notification.notification_type).toBe('challenge_tagged');
    expect(notification.link_url).toBe(`/challenge/${sourced.body.data.public_receipt_slug}`);

    await env.ARENA_DB.prepare(
      `UPDATE audit_log SET after_state = ? WHERE entity_type = 'challenge' AND entity_id = ? AND action = 'challenge.issue'`
    ).bind('{"tampered":true}', sourced.body.data.id).run();

    const tamperedReceipt = await get(`/api/challenges/${sourced.body.data.public_receipt_slug}/receipt`);
    expect(tamperedReceipt.status).toBe(200);
    expect(tamperedReceipt.body.data.audit_chain.status).toBe('failed');
    expect(tamperedReceipt.body.data.audit_chain.failures[0].reason).toMatch(/hash mismatch/);
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

  it('stores write-in priority issues as trimmed secondary data with server-side limits', async () => {
    const voter = await makeVerifiedVoter('writeinvoter');

    const tooMany = await post('/api/surveys/my-priorities', {
      priorities: [{ issue_category_id: 'cat-1', priority_rank: 1 }],
      write_ins: ['local hospitals', 'property insurance', 'farm water', 'transit deserts'],
    }, voter.token);
    expect(tooMany.status).toBe(400);

    const duplicate = await post('/api/surveys/my-priorities', {
      priorities: [{ issue_category_id: 'cat-1', priority_rank: 1 }],
      write_ins: ['Local hospitals', ' local   hospitals '],
    }, voter.token);
    expect(duplicate.status).toBe(400);

    const valid = await post('/api/surveys/my-priorities', {
      priorities: [
        { issue_category_id: 'cat-1', priority_rank: 1 },
        { issue_category_id: 'cat-15', priority_rank: 2 },
      ],
      write_ins: ['  Local hospital closures  ', 'property insurance'],
    }, voter.token);
    expect(valid.status).toBe(200);
    expect(valid.body.data.saved).toBe(2);
    expect(valid.body.data.write_ins_saved).toBe(2);

    const mine = await get('/api/surveys/my-priorities', voter.token);
    expect(mine.status).toBe(200);
    expect(mine.body.data.write_ins.map(writeIn => writeIn.writein_text)).toEqual([
      'Local hospital closures',
      'property insurance',
    ]);

    const aggregate = await get('/api/surveys/priorities/aggregate');
    expect(aggregate.status).toBe(200);
    expect(aggregate.body.data.write_ins.some(writeIn => writeIn.normalized_text === 'local hospital closures')).toBe(true);
  });

  it('stores ranked voter write-ins through the dedicated endpoint', async () => {
    const voter = await makeVerifiedVoter('rankedwriteinvoter');

    const tooMany = await post('/api/surveys/my-writeins', {
      writeins: [
        { writein_text: 'local hospitals', writein_rank: 1 },
        { writein_text: 'property insurance', writein_rank: 2 },
        { writein_text: 'farm water', writein_rank: 3 },
        { writein_text: 'transit deserts', writein_rank: 4 },
      ],
    }, voter.token);
    expect(tooMany.status).toBe(400);

    const duplicateRank = await post('/api/surveys/my-writeins', {
      writeins: [
        { writein_text: 'local hospitals', writein_rank: 1 },
        { writein_text: 'property insurance', writein_rank: 1 },
      ],
    }, voter.token);
    expect(duplicateRank.status).toBe(400);

    const duplicateText = await post('/api/surveys/my-writeins', {
      writeins: [
        { writein_text: 'Local hospitals', writein_rank: 1 },
        { writein_text: ' local   hospitals ', writein_rank: 2 },
      ],
    }, voter.token);
    expect(duplicateText.status).toBe(400);

    const valid = await post('/api/surveys/my-writeins', {
      writeins: [
        { writein_text: ' Property insurance ', writein_rank: 2 },
        { writein_text: 'Local hospital closures', writein_rank: 1 },
      ],
    }, voter.token);
    expect(valid.status).toBe(200);
    expect(valid.body.data.saved).toBe(2);

    const mine = await get('/api/surveys/my-writeins', voter.token);
    expect(mine.status).toBe(200);
    expect(mine.body.data.writeins.map(writeIn => [writeIn.writein_text, writeIn.writein_rank])).toEqual([
      ['Local hospital closures', 1],
      ['Property insurance', 2],
    ]);

    const cleared = await post('/api/surveys/my-writeins', { writeins: [] }, voter.token);
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.saved).toBe(0);

    const empty = await get('/api/surveys/my-writeins', voter.token);
    expect(empty.body.data.writeins).toEqual([]);
  });

  it('returns neutral voter-resource links without collecting voter data', async () => {
    const tx = await get('/api/elections/voter-resources?state=TX');
    expect(tx.status).toBe(200);
    expect(tx.body.data.state).toEqual({ code: 'TX', name: 'Texas' });
    expect(tx.body.data.source_note).toContain('does not collect voter registration data');

    const resourceTypes = tx.body.data.resources.map(resource => resource.type);
    expect(resourceTypes).toEqual([
      'register_or_update',
      'registration_status',
      'polling_place',
      'voter_id',
      'absentee_early_voting',
    ]);
    expect(tx.body.data.resources[0]).toMatchObject({
      provider: 'Vote.gov',
      official: true,
      url: 'https://vote.gov/register',
    });
    expect(tx.body.data.resources.every(resource => resource.url.startsWith('https://'))).toBe(true);

    const fullName = await get('/api/elections/voter-resources?state=District%20of%20Columbia');
    expect(fullName.status).toBe(200);
    expect(fullName.body.data.state).toEqual({ code: 'DC', name: 'District of Columbia' });

    const invalid = await get('/api/elections/voter-resources?state=Atlantis');
    expect(invalid.status).toBe(400);
  });

  it('compares every active race candidate using procedural accountability records', async () => {
    const staff = await registerUser('comparestaff');
    const suffix = Date.now().toString(36);
    const raceId = `edge-compare-race-${suffix}`;
    const candidateA = `edge-compare-a-${suffix}`;
    const candidateB = `edge-compare-b-${suffix}`;
    const candidateC = `edge-compare-c-${suffix}`;
    const challenge1 = `edge-compare-chal-1-${suffix}`;
    const challenge2 = `edge-compare-chal-2-${suffix}`;
    const challenge3 = `edge-compare-chal-3-${suffix}`;
    const adId = `edge-compare-ad-${suffix}`;
    const rebuttalId = `edge-compare-rebuttal-${suffix}`;
    const statementA = `edge-compare-stmt-a-${suffix}`;
    const statementB = `edge-compare-stmt-b-${suffix}`;

    await env.ARENA_DB.batch([
      env.ARENA_DB.prepare(
        `INSERT INTO races (id, name, office, state, district, status)
         VALUES (?, ?, 'Senate', 'TX', NULL, 'active')`
      ).bind(raceId, `Compare Race ${suffix}`),
      env.ARENA_DB.prepare(
        `INSERT INTO candidates (id, race_id, user_id, name, party, verification_status, credit_balance, is_active, issue_positions)
         VALUES (?, ?, ?, 'Compare Alice', 'Democrat', 'verified', 5, 1, ?)`
      ).bind(candidateA, raceId, staff.id, JSON.stringify([{ issue: 'Housing', position: 'Expand supply.' }])),
      env.ARENA_DB.prepare(
        `INSERT INTO candidates (id, race_id, user_id, name, party, verification_status, credit_balance, is_active)
         VALUES (?, ?, ?, 'Compare Bob', 'Republican', 'verified', 5, 1)`
      ).bind(candidateB, raceId, staff.id),
      env.ARENA_DB.prepare(
        `INSERT INTO candidates (id, race_id, user_id, name, party, verification_status, credit_balance, is_active)
         VALUES (?, ?, ?, 'Compare Casey', 'Independent', 'pending', 5, 1)`
      ).bind(candidateC, raceId, staff.id),
      env.ARENA_DB.prepare(
        `INSERT INTO challenges
         (id, race_id, challenger_candidate_id, target_candidate_id, created_by, challenge_text, claim_text, challenge_type, status, deadline_business_days, response_deadline, is_visible)
         VALUES (?, ?, ?, ?, ?, 'Please source this tax claim.', 'The plan raises taxes.', 'fact_check', 'responded', 3, ?, 1)`
      ).bind(challenge1, raceId, candidateB, candidateA, staff.id, new Date(Date.now() + 86400000).toISOString()),
      env.ARENA_DB.prepare(
        `INSERT INTO challenges
         (id, race_id, challenger_candidate_id, target_candidate_id, created_by, challenge_text, challenge_type, status, deadline_business_days, response_deadline, is_visible)
         VALUES (?, ?, ?, ?, ?, 'Will you debate housing policy?', 'debate_request', 'open', 3, ?, 1)`
      ).bind(challenge2, raceId, candidateB, candidateA, staff.id, new Date(Date.now() + 86400000).toISOString()),
      env.ARENA_DB.prepare(
        `INSERT INTO challenges
         (id, race_id, challenger_candidate_id, target_candidate_id, created_by, challenge_text, challenge_type, status, deadline_business_days, response_deadline, is_visible)
         VALUES (?, ?, ?, ?, ?, 'Explain the public-safety vote.', 'policy_question', 'refused', 3, ?, 1)`
      ).bind(challenge3, raceId, candidateA, candidateB, staff.id, new Date(Date.now() - 86400000).toISOString()),
      env.ARENA_DB.prepare(
        `INSERT INTO ad_flights (id, race_id, candidate_id, created_by, title, disclaimer_text, status)
         VALUES (?, ?, ?, ?, 'Compare Ad', 'Paid for by Compare Alice', 'active')`
      ).bind(adId, raceId, candidateA, staff.id),
      env.ARENA_DB.prepare(
        `INSERT INTO rebuttal_ads (id, parent_ad_id, race_id, candidate_id, created_by, response_text, disclaimer_text, status)
         VALUES (?, ?, ?, ?, ?, 'Compare response.', 'Paid for by Compare Bob', 'approved')`
      ).bind(rebuttalId, adId, raceId, candidateB, staff.id),
      env.ARENA_DB.prepare(
        `INSERT INTO public_statements
         (id, candidate_id, race_id, created_by, statement_text, source_type, source_url, truth_status, answer_status, evasion_score, is_public)
         VALUES (?, ?, ?, ?, 'We expanded housing starts.', 'article', ?, 'supported', 'answered', 0, 1)`
      ).bind(statementA, candidateA, raceId, staff.id, `https://example.com/compare-statement-a-${suffix}`),
      env.ARENA_DB.prepare(
        `INSERT INTO public_statements
         (id, candidate_id, race_id, created_by, statement_text, source_type, source_url, truth_status, answer_status, evasion_score, is_public)
         VALUES (?, ?, ?, ?, 'I answered the transit question.', 'article', ?, 'disputed', 'dodged', 70, 1)`
      ).bind(statementB, candidateB, raceId, staff.id, `https://example.com/compare-statement-b-${suffix}`),
      env.ARENA_DB.prepare(
        `INSERT INTO recites (id, content_type, content_id, user_id, url, title, publisher, source_type, stance, status)
         VALUES (?, 'challenge', ?, ?, ?, 'Official tax filing', 'State Revenue Office', 'official_record', 'context', 'verified')`
      ).bind(`edge-compare-rec-${suffix}`, challenge1, staff.id, `https://example.com/compare-rec-${suffix}`),
    ]);

    const res = await get(`/api/races/${raceId}/compare`);
    expect(res.status).toBe(200);
    expect(res.body.data.race).toMatchObject({ id: raceId, office: 'Senate', state: 'TX' });
    expect(res.body.data.candidates.map(candidate => candidate.party)).toEqual([
      'Democrat',
      'Republican',
      'Independent',
    ]);
    expect(res.body.data.metric_note).toContain('procedural counts');

    const alice = res.body.data.candidates.find(candidate => candidate.id === candidateA);
    expect(alice.source_status).toBe('platform_claim');
    expect(alice.issue_positions).toEqual([{ issue: 'Housing', position: 'Expand supply.' }]);
    expect(alice.accountability.targeted_challenges).toMatchObject({
      total: 2,
      open: 1,
      responded: 1,
      response_rate: 50,
    });
    expect(alice.accountability.issued_challenges.total).toBe(1);
    expect(alice.accountability.ads.total).toBe(1);
    expect(alice.accountability.statements.supported).toBe(1);
    expect(alice.accountability.verified_recites.total).toBe(1);

    const bob = res.body.data.candidates.find(candidate => candidate.id === candidateB);
    expect(bob.accountability.targeted_challenges).toMatchObject({
      total: 1,
      refused: 1,
      response_rate: 0,
    });
    expect(bob.accountability.issued_challenges.total).toBe(2);
    expect(bob.accountability.rebuttals.total).toBe(1);
    expect(bob.accountability.statements).toMatchObject({
      total: 1,
      disputed_or_false: 1,
      dodged: 1,
      avg_evasion_score: 70,
    });

    const casey = res.body.data.candidates.find(candidate => candidate.id === candidateC);
    expect(casey.accountability.targeted_challenges.response_rate).toBeNull();
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
    const secondAdmin = await makeAdmin('statementadmin2');
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
    expect(reviewed.body.data.review_status).toBe('pending_second_review');
    expect(reviewed.body.data.requires_second_reviewer).toBe(true);

    const profile = await get(`/api/candidates/${candidateId}/public-profile`);
    expect(profile.status).toBe(200);
    expect(profile.body.data.stats.statements).toBe(1);
    expect(profile.body.data.trust.avg_evasion_score).toBe(0);
    expect(profile.body.data.recent_statements[0].truth_status).toBe('unreviewed');

    const pendingReviews = await get('/api/statements/review-pending', secondAdmin.token);
    expect(pendingReviews.status).toBe(200);
    expect(pendingReviews.body.data.proposals.some(item => item.id === reviewed.body.data.proposal_id)).toBe(true);

    const rubric = await get('/api/statements/review-rubric');
    expect(rubric.status).toBe(200);
    expect(rubric.body.data.rubric.safeguards.high_stakes_reviews_require_second_reviewer).toBe(true);
    expect(rubric.body.data.rubric.safeguards.correction_path).toBe('/api/corrections');

    const sameReviewer = await put(`/api/statements/${created.body.data.id}/review`, {
      truth_status: 'disputed',
      answer_status: 'partial',
      evasion_score: 45,
      confidence_score: 80,
      review_note: 'Same reviewer should not apply.',
    }, admin.token);
    expect(sameReviewer.status).toBe(409);

    const applied = await put(`/api/statements/${created.body.data.id}/review`, {
      truth_status: 'disputed',
      answer_status: 'partial',
      evasion_score: 45,
      confidence_score: 80,
      review_note: 'Second reviewer confirmed the call.',
    }, secondAdmin.token);
    expect(applied.status).toBe(200);
    expect(applied.body.data.review_status).toBe('applied');
    expect(applied.body.data.first_reviewer_id).toBe(admin.id);
    expect(applied.body.data.second_reviewer_id).toBe(secondAdmin.id);

    const reviewedProfile = await get(`/api/candidates/${candidateId}/public-profile`);
    expect(reviewedProfile.status).toBe(200);
    expect(reviewedProfile.body.data.stats.statements).toBe(1);
    expect(reviewedProfile.body.data.trust.avg_evasion_score).toBe(45);
    expect(reviewedProfile.body.data.recent_statements[0].truth_status).toBe('disputed');

    const row = await env.ARENA_DB.prepare(
      `SELECT status, second_reviewer_id FROM statement_review_proposals WHERE id = ?`
    ).bind(reviewed.body.data.proposal_id).first();
    expect(row.status).toBe('applied');
    expect(row.second_reviewer_id).toBe(secondAdmin.id);

    const search = await get('/api/statements/search?q=property%20taxes');
    expect(search.status).toBe(200);
    expect(search.body.data.statements.some(item => item.id === created.body.data.id)).toBe(true);
  });

  it('records correction requests and publishes moderator resolution notes', async () => {
    const voter = await makeVerifiedVoter('correctionvoter');
    const admin = await makeAdmin('correctionadmin');
    const suffix = Date.now().toString(36);
    const statementId = `edge-correction-stmt-${suffix}`;

    await env.ARENA_DB.prepare(
      `INSERT INTO public_statements
       (id, candidate_id, race_id, created_by, statement_text, source_type, source_url, truth_status, answer_status, evasion_score)
       VALUES (?, 'cand-1', 'race-1', 'system', 'Correction target statement.', 'article', ?, 'supported', 'answered', 0)`
    ).bind(statementId, `https://example.com/correction-target-${suffix}`).run();

    const missing = await post('/api/corrections', {
      content_type: 'statement',
      content_id: `missing-${suffix}`,
      reason: 'factual_error',
      requested_change: 'This request should fail because the target does not exist.',
    }, voter.token);
    expect(missing.status).toBe(404);

    const created = await post('/api/corrections', {
      content_type: 'statement',
      content_id: statementId,
      candidate_id: 'cand-1',
      reason: 'score_dispute',
      requested_change: 'The statement needs a public note explaining the source context.',
      evidence_url: `https://example.com/evidence-${suffix}`,
    }, voter.token);
    expect(created.status).toBe(200);
    expect(created.body.data.status).toBe('open');

    const mine = await get('/api/corrections/mine', voter.token);
    expect(mine.status).toBe(200);
    expect(mine.body.data.corrections.some(item => item.id === created.body.data.id)).toBe(true);

    const publicBefore = await get(`/api/corrections/public?content_type=statement&content_id=${statementId}`);
    expect(publicBefore.status).toBe(200);
    expect(publicBefore.body.data.corrections).toHaveLength(1);
    expect(publicBefore.body.data.events.some(event => event.event_type === 'submitted')).toBe(true);

    const queue = await get('/api/corrections/pending?status=open', admin.token);
    expect(queue.status).toBe(200);
    expect(queue.body.data.corrections.some(item => item.id === created.body.data.id)).toBe(true);

    const reviewedCorrection = await put(`/api/corrections/${created.body.data.id}/review`, {
      status: 'revised',
      resolution_note: 'Source context reviewed and public note added.',
      public_note: 'Corrected July 5, 2026: source context was added after review.',
    }, admin.token);
    expect(reviewedCorrection.status).toBe(200);
    expect(reviewedCorrection.body.data.status).toBe('revised');

    const publicAfter = await get(`/api/corrections/public?content_type=statement&content_id=${statementId}`);
    expect(publicAfter.status).toBe(200);
    expect(publicAfter.body.data.corrections[0].public_note).toContain('Corrected July 5, 2026');
    expect(publicAfter.body.data.events.some(event => event.event_type === 'public_note')).toBe(true);

    const audit = await env.ARENA_DB.prepare(
      `SELECT action FROM audit_log WHERE entity_type = 'correction_request' AND entity_id = ? ORDER BY chain_seq ASC`
    ).bind(created.body.data.id).all();
    expect((audit.results || []).map(row => row.action)).toEqual(['correction.submit', 'correction.review']);
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
