/**
 * Arena domain integration tests — real worker, real D1.
 * Covers: demo seed availability in test env, ad visibility rules,
 * the ad-activation authorization fix, and the challenge credit lifecycle.
 */
import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { seedOutsideAdExamples } from '../src/db.js';

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
    const race = races.find(r => r.id === 'race-1');
    expect(race).toBeTruthy();
    expect(Array.isArray(race.candidates_summary)).toBe(true);
    expect(race.candidates_summary.length).toBeLessThanOrEqual(2);
    expect(race.candidates_summary[0]).toMatchObject({
      name: expect.any(String),
      party: expect.any(String),
    });
    expect(Object.prototype.hasOwnProperty.call(race, 'open_callout')).toBe(true);
    if (race.open_callout) {
      expect(race.open_callout).toMatchObject({
        target_name: expect.any(String),
        claim_text: expect.any(String),
        response_deadline: expect.any(String),
      });
    }
  });

  it('serves public launch stats and live feed events', async () => {
    const stats = await get('/api/stats/cycle');
    expect(stats.status).toBe(200);
    expect(stats.body.data).toMatchObject({
      races_live: expect.any(Number),
      open_callouts: expect.any(Number),
      response_rate: expect.any(Number),
      election_date: '2026-11-03',
    });

    const feed = await get('/api/feed/live');
    expect(feed.status).toBe(200);
    expect(Array.isArray(feed.body.data.events)).toBe(true);
    expect(feed.body.data.limit).toBe(20);
    expect(feed.body.data.events.length).toBeGreaterThan(0);
    expect(feed.body.data.events[0]).toMatchObject({
      event_type: expect.stringMatching(/^(issued|responded|refused|expired)$/),
      event_at: expect.any(String),
      challenge_id: expect.any(String),
      public_receipt_slug: expect.any(String),
      race_id: expect.any(String),
      race_label: expect.any(String),
      challenger_name: expect.any(String),
      target_name: expect.any(String),
    });
  });

  it('serves seeded public press feed link metadata', async () => {
    const feed = await get('/api/press/feed?limit=10');
    expect(feed.status).toBe(200);
    expect(feed.body.data.limit).toBe(10);
    expect(feed.body.data.items.length).toBeGreaterThanOrEqual(4);

    const publishers = new Set(feed.body.data.items.map(item => item.publisher));
    expect(publishers.has('Newser')).toBe(true);
    expect(publishers.has('Straight Arrow News')).toBe(true);

    const item = feed.body.data.items[0];
    expect(item).toMatchObject({
      id: expect.any(String),
      source: expect.any(String),
      source_type: 'news',
      title: expect.any(String),
      url: expect.stringMatching(/^https:\/\//),
      publisher: expect.any(String),
      change_status: expect.stringMatching(/^(new|updated|removed)$/),
    });
    expect(Object.prototype.hasOwnProperty.call(item, 'first_seen_at')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(item, 'last_seen_at')).toBe(true);

    const oversight = await get('/api/press/feed?section=Government%20Oversight');
    expect(oversight.status).toBe(200);
    expect(oversight.body.data.items.length).toBeGreaterThanOrEqual(1);
    expect(oversight.body.data.items.every(item => item.section === 'Government Oversight')).toBe(true);
  });

  it('includes challenge recite summaries on race detail', async () => {
    const suffix = Date.now().toString(36);
    const sourceUrl = `https://example.com/race-summary-source-${suffix}`;

    await env.ARENA_DB.prepare(
      `INSERT INTO recites
       (id, content_type, content_id, user_id, url, title, publisher, source_type, stance, claim_text, quote, status)
       VALUES (?, 'challenge', 'chal-3', ?, ?, 'State environmental filing', 'Environmental Agency', 'official_record', 'supports', 'The deregulation plan affects local environment rules.', 'The filing describes the environmental rule changes.', 'verified')`
    ).bind(`rec-race-summary-${suffix}`, staffUser.id, sourceUrl).run();

    const res = await get('/api/races/race-1');
    expect(res.status).toBe(200);
    const challenge = res.body.data.challenges.find(ch => ch.id === 'chal-3');
    expect(challenge).toBeTruthy();
    expect(challenge.challenge_recite_summary).toMatchObject({
      recite_count: expect.any(Number),
      fact_score: {
        score: expect.any(Number),
        label: expect.any(String),
        confidence: expect.any(Number),
      },
      top_source: {
        title: expect.any(String),
        publisher: expect.any(String),
        source_type: expect.any(String),
        stance: expect.any(String),
        status: 'verified',
        url: expect.any(String),
      },
    });
    expect(challenge.challenge_recite_summary.recite_count).toBeGreaterThanOrEqual(1);
    expect(challenge.challenge_recite_summary.fact_score.score).toBeGreaterThan(50);
    expect(
      challenge.challenge_recite_summary.top_source.url === sourceUrl ||
      challenge.challenge_recite_summary.recite_count > 1
    ).toBe(true);
  });

  it('serves seeded voter and press questions for demo races', async () => {
    const raceOne = await get('/api/questions/race-1');
    expect(raceOne.status).toBe(200);
    expect(raceOne.body.data.questions.length).toBeGreaterThanOrEqual(4);

    const raceOneQuestions = raceOne.body.data.questions;
    const raceOneIds = new Set(raceOneQuestions.map(q => q.id));
    const raceOneSourceTypes = new Set(raceOneQuestions.map(q => q.source_type));
    expect(raceOneIds.has('q-demo-r1-voter-healthcare')).toBe(true);
    expect(raceOneIds.has('q-demo-r1-press-economy')).toBe(true);
    expect(raceOneSourceTypes.has('voter')).toBe(true);
    expect(raceOneSourceTypes.has('press')).toBe(true);
    expect(raceOneQuestions[0].vote_count).toBeGreaterThanOrEqual(raceOneQuestions[1].vote_count);
    expect(raceOneQuestions[0]).toMatchObject({
      author_name: expect.any(String),
      is_top: true,
    });

    const raceTwo = await get('/api/questions/race-2');
    expect(raceTwo.status).toBe(200);
    expect(raceTwo.body.data.questions.length).toBeGreaterThanOrEqual(4);
    const raceTwoIds = new Set(raceTwo.body.data.questions.map(q => q.id));
    expect(raceTwoIds.has('q-demo-r2-voter-housing')).toBe(true);
    expect(raceTwoIds.has('q-demo-r2-press-grid')).toBe(true);

    const top = await get('/api/questions/race-1/top');
    expect(top.status).toBe(200);
    expect(top.body.data.voter_questions.length).toBeGreaterThanOrEqual(1);
    expect(top.body.data.press_questions.length).toBeGreaterThanOrEqual(1);
    expect(top.body.data.voter_questions[0]).toMatchObject({
      source_type: 'voter',
      is_top: true,
    });
    expect(top.body.data.press_questions[0]).toMatchObject({
      source_type: 'press',
      is_top: true,
    });
  });

  it('seeds real linked TV ad examples with open response slots and source recites', async () => {
    await env.ARENA_DB.batch([
      env.ARENA_DB.prepare(
        `INSERT OR IGNORE INTO races (id, name, office, state, district, status)
         VALUES ('race-2026-NC-S', '2026 NC Senate Race', 'Senate', 'NC', '', 'upcoming')`
      ),
      env.ARENA_DB.prepare(
        `INSERT OR IGNORE INTO races (id, name, office, state, district, status)
         VALUES ('race-2026-KY-S', '2026 KY Senate Race', 'Senate', 'KY', '', 'upcoming')`
      ),
      env.ARENA_DB.prepare(
        `INSERT OR IGNORE INTO candidates (id, race_id, name, party, verification_status, is_active)
         VALUES ('cand-fec-s6nc00407', 'race-2026-NC-S', 'COOPER, ROY', 'Democrat', 'pending', 1)`
      ),
      env.ARENA_DB.prepare(
        `INSERT OR IGNORE INTO candidates (id, race_id, name, party, verification_status, is_active)
         VALUES ('cand-fec-s6ky00286', 'race-2026-KY-S', 'BARR, GARLAND ANDY', 'Republican', 'pending', 1)`
      ),
    ]);
    await seedOutsideAdExamples(env.ARENA_DB);

    const systemUser = await env.ARENA_DB.prepare(
      `SELECT email, role, is_active FROM users WHERE id = 'system'`
    ).first();
    expect(systemUser).toMatchObject({
      email: 'system@arena.internal',
      role: 'admin',
      is_active: 0,
    });

    const ncRace = await get('/api/races/race-2026-NC-S');
    expect(ncRace.status).toBe(200);
    const cooperAd = ncRace.body.data.ads.find(ad => ad.id === 'ad-ext-roy-cooper-easier-2026');
    expect(cooperAd).toMatchObject({
      source_type: 'external',
      media_type: 'video',
      max_rebuttals: 1,
      source_label: 'SAMPLE official campaign TV ad link',
      ad_recite_summary: {
        recite_count: expect.any(Number),
        fact_score: {
          score: expect.any(Number),
          label: expect.any(String),
        },
        top_source: expect.any(Object),
      },
    });
    expect(ncRace.body.data.rebuttals.filter(rebuttal => rebuttal.parent_ad_id === cooperAd.id)).toHaveLength(0);
    expect(cooperAd.ad_recite_summary.recite_count).toBeGreaterThanOrEqual(2);

    const kyRace = await get('/api/races/race-2026-KY-S');
    expect(kyRace.status).toBe(200);
    const barrAd = kyRace.body.data.ads.find(ad => ad.id === 'ad-ext-andy-barr-stop-dei-2026');
    expect(barrAd).toMatchObject({
      source_type: 'external',
      media_type: 'video',
      max_rebuttals: 1,
    });
    expect(kyRace.body.data.rebuttals.filter(rebuttal => rebuttal.parent_ad_id === barrAd.id)).toHaveLength(0);
    expect(barrAd.ad_recite_summary.recite_count).toBeGreaterThanOrEqual(2);
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
