/**
 * End-to-end API smoke coverage for the main operational workflows.
 * Uses the real Worker and D1 bindings, with an isolated race/candidate set.
 */
import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'https://example.com';
const VALID_PASSWORD = 'Str0ng!Passw0rd';
const SAMPLE_VIDEO_URL = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
let seq = 0;

async function api(method, path, body, token) {
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
  return api('POST', path, body, token);
}

async function put(path, body, token) {
  return api('PUT', path, body, token);
}

async function get(path, token) {
  return api('GET', path, undefined, token);
}

async function registerUser(label) {
  seq += 1;
  const suffix = `${Date.now().toString(36)}${seq}`;
  const res = await post('/api/auth/register', {
    email: `smoke-${label}-${suffix}@example.com`,
    username: `smoke_${label}_${seq}`.slice(0, 30),
    password: VALID_PASSWORD,
    display_name: `Smoke ${label}`,
  });
  expect(res.status).toBe(200);
  return { token: res.body.data.token, id: res.body.data.user.id };
}

describe('production workflow smoke', () => {
  let raceId;
  let candidateA;
  let candidateB;
  let staffA;
  let staffB;
  let admin;
  let voter;
  let press;

  beforeAll(async () => {
    await SELF.fetch(`${BASE}/api/health`);
    const suffix = Date.now().toString(36);
    raceId = `smoke-race-${suffix}`;
    candidateA = `smoke-cand-a-${suffix}`;
    candidateB = `smoke-cand-b-${suffix}`;

    [staffA, staffB, admin, voter, press] = await Promise.all([
      registerUser('staffa'),
      registerUser('staffb'),
      registerUser('admin'),
      registerUser('voter'),
      registerUser('press'),
    ]);

    await env.ARENA_DB.batch([
      env.ARENA_DB.prepare(
        `UPDATE users SET role = 'admin', verification_status = 'verified', email_verified = 1 WHERE id = ?`
      ).bind(admin.id),
      env.ARENA_DB.prepare(
        `UPDATE users SET verification_status = 'verified', email_verified = 1, party_affiliation = 'Democrat', jurisdiction_state = 'AL' WHERE id = ?`
      ).bind(voter.id),
      env.ARENA_DB.prepare(
        `INSERT INTO races (id, name, office, state, district, status) VALUES (?, ?, 'House', 'AL', '99', 'active')`
      ).bind(raceId, `Smoke Race ${suffix}`),
      env.ARENA_DB.prepare(
        `INSERT INTO candidates (id, race_id, user_id, name, party, verification_status, credit_balance, is_active)
         VALUES (?, ?, ?, 'Smoke Candidate A', 'Democrat', 'verified', 5, 1)`
      ).bind(candidateA, raceId, staffA.id),
      env.ARENA_DB.prepare(
        `INSERT INTO candidates (id, race_id, user_id, name, party, verification_status, credit_balance, is_active)
         VALUES (?, ?, ?, 'Smoke Candidate B', 'Republican', 'verified', 5, 1)`
      ).bind(candidateB, raceId, staffB.id),
      env.ARENA_DB.prepare(
        `INSERT INTO candidate_staff_links (id, user_id, candidate_id, role, is_active) VALUES (?, ?, ?, 'primary', 1)`
      ).bind(`smoke-link-a-${suffix}`, staffA.id, candidateA),
      env.ARENA_DB.prepare(
        `INSERT INTO candidate_staff_links (id, user_id, candidate_id, role, is_active) VALUES (?, ?, ?, 'primary', 1)`
      ).bind(`smoke-link-b-${suffix}`, staffB.id, candidateB),
    ]);
  });

  it('keeps demo race media renderable for public race pages', async () => {
    const race = await get('/api/races/race-1');
    expect(race.status).toBe(200);

    const ads = race.body.data.ads || [];
    const rebuttals = race.body.data.rebuttals || [];
    const challengeResponses = race.body.data.challengeResponses || [];
    const mediaUrls = [
      ...ads.map(ad => ad.media_url),
      ...rebuttals.map(rebuttal => rebuttal.media_url),
      ...challengeResponses.map(response => response.media_url),
    ].filter(Boolean);

    expect(mediaUrls.length).toBeGreaterThan(0);
    expect(mediaUrls.every(url => !url.includes('example.com'))).toBe(true);
    expect(mediaUrls.every(url => /\.(png|mp4)(\?|#|$)/i.test(new URL(url).pathname))).toBe(true);
  });

  it('seeds source-backed demo recites for race summaries and receipts', async () => {
    const race = await get('/api/races/race-1');
    expect(race.status).toBe(200);

    const challenges = race.body.data.challenges || [];
    const responded = challenges.filter(challenge => ['chal-1', 'chal-4'].includes(challenge.id));
    expect(responded).toHaveLength(2);
    for (const challenge of responded) {
      expect(challenge.challenge_recite_summary.recite_count).toBeGreaterThan(0);
      expect(challenge.challenge_recite_summary.fact_score.verified_count).toBeGreaterThan(0);
      expect(challenge.challenge_recite_summary.top_source).toMatchObject({
        title: expect.any(String),
        status: 'verified',
        url: expect.any(String),
      });
    }

    const receipt = await get('/api/challenges/chal-1/receipt');
    expect(receipt.status).toBe(200);
    expect(receipt.body.data.recites.length).toBeGreaterThan(0);
    expect(receipt.body.data.response_recites.length).toBeGreaterThan(0);
    expect(receipt.body.data.fact_score.verified_count).toBeGreaterThan(0);
    expect(receipt.body.data.response_fact_score.verified_count).toBeGreaterThan(0);
    expect(receipt.body.data.recites.some(recite => recite.archive_url && recite.review_note)).toBe(true);
  });

  it('runs the core voter, press, ad, credit, and challenge workflows', async () => {
    const me = await get('/api/users/me', staffA.token);
    expect(me.status).toBe(200);
    expect(me.body.data.staff_links.some(link => link.candidate_id === candidateA)).toBe(true);

    const priorities = await post('/api/surveys/my-priorities', {
      race_id: raceId,
      priorities: [
        { issue_category_id: 'cat-1', priority_rank: 1 },
        { issue_category_id: 'cat-2', priority_rank: 2 },
        { issue_category_id: 'cat-3', priority_rank: 3 },
      ],
    }, voter.token);
    expect(priorities.status).toBe(200);

    const question = await post(`/api/questions/${raceId}`, {
      source_type: 'voter',
      question_text: 'How will you lower healthcare costs for families?',
    }, voter.token);
    expect(question.status).toBe(200);

    const vote = await post(`/api/questions/${question.body.data.id}/vote`, {}, voter.token);
    expect(vote.status).toBe(200);
    expect(vote.body.data.voted).toBe(true);

    const pressApplication = await post('/api/press/register', {
      outlet_name: 'Smoke Daily',
      outlet_type: 'digital',
      proof_url: 'https://example.com/press',
    }, press.token);
    expect(pressApplication.status).toBe(200);

    const pressReview = await put(`/api/press/${pressApplication.body.data.id}/review`, {
      action: 'approve',
    }, admin.token);
    expect(pressReview.status).toBe(200);

    const ad = await post('/api/ads', {
      race_id: raceId,
      candidate_id: candidateA,
      title: 'Smoke Ad',
      ad_content_text: 'A clear campaign message for smoke testing.',
      disclaimer_text: 'Paid for by Smoke Candidate A',
    }, staffA.token);
    expect(ad.status).toBe(200);

    const submitted = await post(`/api/ads/${ad.body.data.id}/submit`, {}, staffA.token);
    expect(submitted.status).toBe(200);

    const reviewed = await post(`/api/ads/${ad.body.data.id}/review`, { action: 'approve' }, admin.token);
    expect(reviewed.status).toBe(200);

    const activated = await post(`/api/ads/${ad.body.data.id}/activate`, {}, staffA.token);
    expect(activated.status).toBe(200);

    const ads = await get(`/api/ads/races/${raceId}`);
    expect(ads.status).toBe(200);
    expect(ads.body.data.ads.some(item => item.id === ad.body.data.id)).toBe(true);

    const outsideResponse = await post('/api/ads/external-response', {
      race_id: raceId,
      source_candidate_id: candidateA,
      responder_candidate_id: candidateB,
      source_title: 'Outside TV Attack Ad',
      source_media_url: SAMPLE_VIDEO_URL,
      source_description: 'The outside ad claims the challenger supports a tax increase.',
      response_text: 'Here is the record and the context voters need before they believe that claim.',
      response_media_url: SAMPLE_VIDEO_URL,
      disclaimer_text: 'Paid for by Smoke Candidate B',
    }, staffB.token);
    expect(outsideResponse.status).toBe(200);

    const adsAfterOutsideResponse = await get(`/api/ads/races/${raceId}`);
    expect(adsAfterOutsideResponse.status).toBe(200);
    const outsideAd = adsAfterOutsideResponse.body.data.ads.find(item => item.id === outsideResponse.body.data.ad_id);
    expect(outsideAd.source_type).toBe('external');
    expect(outsideAd.posted_for_rebuttal_by).toBe(candidateB);
    expect(outsideAd.rebuttals.some(item => item.id === outsideResponse.body.data.rebuttal_id && item.candidate_id === candidateB)).toBe(true);

    const creditsBefore = await get(`/api/credits/${candidateA}`, staffA.token);
    expect(creditsBefore.status).toBe(200);

    const challenge = await post('/api/challenges', {
      race_id: raceId,
      challenger_candidate_id: candidateA,
      target_candidate_id: candidateB,
      challenge_text: 'Please explain your infrastructure funding plan in detail.',
      challenge_type: 'policy_question',
    }, staffA.token);
    expect(challenge.status).toBe(200);

    const response = await post(`/api/challenges/${challenge.body.data.id}/respond`, {
      response_text: 'Our plan uses matched grants, transparent procurement, and public progress reports.',
    }, staffB.token);
    expect(response.status).toBe(200);

    const refusalChallenge = await post('/api/challenges', {
      race_id: raceId,
      challenger_candidate_id: candidateB,
      target_candidate_id: candidateA,
      challenge_text: 'Will you join a public forum on education funding?',
      challenge_type: 'debate_request',
    }, staffB.token);
    expect(refusalChallenge.status).toBe(200);

    const refused = await post(`/api/challenges/${refusalChallenge.body.data.id}/refuse`, {
      refusal_reason: 'Scheduling conflict for the proposed date.',
    }, staffA.token);
    expect(refused.status).toBe(200);

    const race = await get(`/api/races/${raceId}`);
    expect(race.status).toBe(200);
    expect(race.body.data.challenges.some(item => item.id === challenge.body.data.id && item.status === 'responded')).toBe(true);
    expect(race.body.data.challenges.some(item => item.id === refusalChallenge.body.data.id && item.status === 'refused')).toBe(true);
  });
});
