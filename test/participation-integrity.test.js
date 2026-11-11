/**
 * Participation integrity — real worker, real D1.
 *
 * Proves a coordinated group cannot manufacture an "unanswered" wall:
 * duplicates collapse onto one question, floods slow only brand-new accounts,
 * one candidate cannot be buried under callouts, and every voter action carries
 * a self-reported jurisdiction label that never blocks participation.
 */
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { jurisdictionMatch, normalizeDistrict, normalizeQuestionText, questionFingerprint } from '../src/integrity.js';
import { backfillQuestionFingerprints } from '../src/db.js';

const BASE = 'https://example.com';
const PASSWORD = 'Str0ng!Passw0rd';
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

async function participant(label, { state = null, district = null, ageDays = 30 } = {}) {
  seq += 1;
  const res = await api('POST', '/api/auth/register', {
    email: `pi-${label}-${seq}-${Date.now().toString(36)}@example.com`,
    username: `pi_${label}_${seq}`.slice(0, 30),
    password: PASSWORD,
    display_name: `PI ${label}`,
  });
  expect(res.status).toBe(200);
  const id = res.body.data.user.id;
  await env.ARENA_DB.prepare(
    `UPDATE users SET email_verified = 1, jurisdiction_state = ?, jurisdiction_district = ?,
       created_at = datetime('now', ?) WHERE id = ?`
  ).bind(state, district, `-${ageDays} days`, id).run();
  return { id, token: res.body.data.token };
}

async function makeRace(label, { office = 'House', state = 'TX', district = '07' } = {}) {
  seq += 1;
  const id = `race-pi-${label}-${seq}`;
  await env.ARENA_DB.prepare(
    `INSERT INTO races (id, name, office, state, district) VALUES (?, ?, ?, ?, ?)`
  ).bind(id, `PI ${label} race`, office, state, district).run();
  return id;
}

const ask = (raceId, text, user) => api('POST', `/api/questions/${raceId}`, { source_type: 'voter', question_text: text }, user.token);

beforeAll(async () => {
  await SELF.fetch(`${BASE}/api/health`);
});

describe('jurisdiction label (pure)', () => {
  const house = { office: 'House', state: 'TX', district: '07' };
  it('labels district, state, outside and missing locations', () => {
    expect(jurisdictionMatch({ jurisdiction_state: 'TX', jurisdiction_district: '7' }, house)).toBe('in_jurisdiction');
    expect(jurisdictionMatch({ jurisdiction_state: 'tx', jurisdiction_district: 'TX-07' }, house)).toBe('in_jurisdiction');
    expect(jurisdictionMatch({ jurisdiction_state: 'TX', jurisdiction_district: '12' }, house)).toBe('in_state');
    expect(jurisdictionMatch({ jurisdiction_state: 'TX' }, house)).toBe('in_state');
    expect(jurisdictionMatch({ jurisdiction_state: 'CA', jurisdiction_district: '7' }, house)).toBe('outside');
    expect(jurisdictionMatch({}, house)).toBe('not_stated');
    expect(jurisdictionMatch(null, house)).toBe('not_stated');
  });

  it('treats statewide offices as one jurisdiction and ignores the district', () => {
    for (const office of ['Senate', 'Governor']) {
      expect(jurisdictionMatch({ jurisdiction_state: 'TX', jurisdiction_district: '99' }, { office, state: 'TX', district: null })).toBe('in_jurisdiction');
      expect(jurisdictionMatch({ jurisdiction_state: 'OK' }, { office, state: 'TX', district: null })).toBe('outside');
    }
  });

  it('rejects malformed states instead of matching them', () => {
    expect(jurisdictionMatch({ jurisdiction_state: 'T' }, house)).toBe('not_stated');
    expect(jurisdictionMatch({ jurisdiction_state: "TX' OR 1=1" }, house)).toBe('not_stated');
    expect(jurisdictionMatch({ jurisdiction_state: 'TX', jurisdiction_district: 'seven' }, house)).toBe('in_state');
  });

  it('normalizes at-large and zero-padded districts', () => {
    expect(normalizeDistrict('At-Large')).toBe('0');
    expect(normalizeDistrict('00')).toBe('0');
    expect(normalizeDistrict('AL')).toBe('0');
    expect(normalizeDistrict('007')).toBe('7');
    expect(normalizeDistrict('')).toBe('');
    expect(jurisdictionMatch({ jurisdiction_state: 'WY', jurisdiction_district: 'at large' }, { office: 'House', state: 'WY', district: '00' })).toBe('in_jurisdiction');
  });
});

describe('duplicate fingerprint (pure)', () => {
  it('collapses case, spacing, punctuation and full-width look-alikes', async () => {
    const base = await questionFingerprint('Will you release your tax returns?');
    for (const variant of [
      'will you release your tax returns',
      '  WILL   you release\nyour tax returns?!?!  ',
      'Will you release your tax returns ???',
      'Ｗｉｌｌ you release your tax returns?',
    ]) {
      expect(await questionFingerprint(variant), variant).toBe(base);
    }
    expect(await questionFingerprint('Will you release your medical records?')).not.toBe(base);
  });

  it('keeps non-English letters and has no fingerprint for symbol-only text', async () => {
    expect(normalizeQuestionText('¿Publicará sus impuestos?')).toBe('publicará sus impuestos');
    expect(await questionFingerprint('?!?! ... ###')).toBeNull();
    expect(await questionFingerprint('')).toBeNull();
  });
});

describe('question duplicates', () => {
  it('rejects a reworded-punctuation duplicate and points to the original', async () => {
    const raceId = await makeRace('dup');
    const first = await participant('dup_a');
    const second = await participant('dup_b');

    const original = await ask(raceId, 'Will you release your tax returns before the election?', first);
    expect(original.status).toBe(200);

    const copy = await ask(raceId, 'WILL YOU RELEASE your tax returns before the election!!!', second);
    expect(copy.status).toBe(409);
    expect(copy.body.existing_question_id).toBe(original.body.data.id);

    const count = await env.ARENA_DB.prepare(`SELECT COUNT(*) as cnt FROM questions WHERE race_id = ?`).bind(raceId).first();
    expect(count.cnt).toBe(1);
  });

  it('allows the same question in a different race', async () => {
    const user = await participant('dup_cross');
    const text = 'What is your position on the state water plan?';
    expect((await ask(await makeRace('dup_x1'), text, user)).status).toBe(200);
    expect((await ask(await makeRace('dup_x2'), text, user)).status).toBe(200);
  });

  it('keeps exactly one row when identical questions are submitted concurrently', async () => {
    const raceId = await makeRace('dup_race');
    const users = await Promise.all(Array.from({ length: 6 }, (_, i) => participant(`dup_c${i}`)));
    const results = await Promise.all(users.map(u => ask(raceId, 'Where do you stand on the port expansion bond?', u)));

    expect(results.filter(r => r.status === 200)).toHaveLength(1);
    expect(results.filter(r => r.status === 409)).toHaveLength(5);
    const count = await env.ARENA_DB.prepare(`SELECT COUNT(*) as cnt FROM questions WHERE race_id = ?`).bind(raceId).first();
    expect(count.cnt).toBe(1);
  });

  it('lets a question be asked again after a moderator hides the original', async () => {
    const raceId = await makeRace('dup_hidden');
    const user = await participant('dup_hidden');
    const text = 'Do you support the county transit referendum?';
    const first = await ask(raceId, text, user);
    await env.ARENA_DB.prepare(`UPDATE questions SET status = 'hidden' WHERE id = ?`).bind(first.body.data.id).run();
    expect((await ask(raceId, text, user)).status).toBe(200);
  });

  it('rejects symbol-only padding that passes the length check', async () => {
    const res = await ask(await makeRace('dup_symbols'), '?!?!?!?!?!?!?!?!', await participant('dup_symbols'));
    expect(res.status).toBe(400);
  });
});

describe('question volume limits', () => {
  it('caps one account per race per day', async () => {
    const raceId = await makeRace('per_race');
    const user = await participant('per_race');
    for (let i = 0; i < 5; i++) {
      expect((await ask(raceId, `Distinct per-race question number ${i} about roads`, user)).status).toBe(200);
    }
    const blocked = await ask(raceId, 'A sixth distinct question about the budget', user);
    expect(blocked.status).toBe(429);
  });

  it('caps one account across all races per day', async () => {
    const user = await participant('per_day');
    let accepted = 0;
    let last;
    for (let i = 0; i < 17; i++) {
      last = await ask(await makeRace(`per_day_${i}`), `Cross-race question ${i} about school funding`, user);
      if (last.status === 200) accepted += 1;
    }
    expect(accepted).toBe(15);
    expect(last.status).toBe(429);
    expect(last.body.error).toContain('across all races');
  });

  it('during a flood slows only brand-new accounts, never established ones', async () => {
    const raceId = await makeRace('surge');
    const seedAuthor = await participant('surge_seed');
    // Simulate the flood directly: 30 questions in the last hour.
    const statements = [];
    for (let i = 0; i < 30; i++) {
      statements.push(env.ARENA_DB.prepare(
        `INSERT INTO questions (id, race_id, user_id, source_type, question_text, text_fingerprint) VALUES (?, ?, ?, 'voter', ?, ?)`
      ).bind(`q-surge-${seq}-${i}`, raceId, seedAuthor.id, `Flood question ${i}`, `flood-${seq}-${i}`));
    }
    await env.ARENA_DB.batch(statements);

    const fresh = await participant('surge_new', { ageDays: 0 });
    const blocked = await ask(raceId, 'A new account joins the flood with a fresh question', fresh);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toContain('unusually high');

    const established = await participant('surge_old', { ageDays: 60 });
    const allowed = await ask(raceId, 'An established local voter still gets to ask this', established);
    expect(allowed.status).toBe(200);

    // The new account is not locked out of the race: it can still upvote.
    const vote = await api('POST', `/api/questions/${allowed.body.data.id}/vote`, {}, fresh.token);
    expect(vote.status).toBe(200);
    expect(vote.body.data.voted).toBe(true);
  });

  it('does not slow new accounts when the race is quiet', async () => {
    const fresh = await participant('quiet_new', { ageDays: 0 });
    expect((await ask(await makeRace('quiet'), 'A brand new voter asks about flood insurance', fresh)).status).toBe(200);
  });
});

describe('jurisdiction labels on questions and votes', () => {
  it('records the author label and a per-jurisdiction vote breakdown without blocking anyone', async () => {
    const raceId = await makeRace('labels', { office: 'House', state: 'TX', district: '07' });
    const local = await participant('lab_local', { state: 'TX', district: '7' });
    const neighbor = await participant('lab_state', { state: 'TX', district: '22' });
    const outsider = await participant('lab_out', { state: 'NY', district: '12' });
    const silent = await participant('lab_silent');

    const question = await ask(raceId, 'How will you vote on the regional flood control district?', outsider);
    expect(question.status).toBe(200);
    expect(question.body.data.author_jurisdiction).toBe('outside');

    for (const voter of [local, neighbor, outsider, silent]) {
      const vote = await api('POST', `/api/questions/${question.body.data.id}/vote`, {}, voter.token);
      expect(vote.status).toBe(200);
    }

    const list = await api('GET', `/api/questions/${raceId}`);
    const row = list.body.data.questions[0];
    expect(row.vote_count).toBe(4);
    expect(row.vote_breakdown).toEqual({ in_jurisdiction: 1, in_state: 1, outside: 1, not_stated: 1 });
    expect(row.author_jurisdiction).toBe('outside');
    expect(list.body.data.jurisdiction_note).toContain('self-reported');
  });

  it('removes a vote from the breakdown when it is withdrawn', async () => {
    const raceId = await makeRace('unvote', { office: 'Senate', state: 'GA', district: null });
    const voter = await participant('unvote', { state: 'GA' });
    const q = await ask(raceId, 'Will you hold town halls in every county this year?', voter);
    await api('POST', `/api/questions/${q.body.data.id}/vote`, {}, voter.token);
    await api('POST', `/api/questions/${q.body.data.id}/vote`, {}, voter.token);
    const list = await api('GET', `/api/questions/${raceId}`);
    expect(list.body.data.questions[0].vote_count).toBe(0);
    expect(list.body.data.questions[0].vote_breakdown.in_jurisdiction).toBe(0);
  });

  it('snapshots the label at vote time; a later profile change does not rewrite history', async () => {
    const raceId = await makeRace('snapshot', { office: 'Governor', state: 'OH', district: null });
    const voter = await participant('snapshot', { state: 'MI' });
    const q = await ask(raceId, 'What is your plan for the turnpike toll increase?', voter);
    await api('POST', `/api/questions/${q.body.data.id}/vote`, {}, voter.token);
    await env.ARENA_DB.prepare(`UPDATE users SET jurisdiction_state = 'OH' WHERE id = ?`).bind(voter.id).run();
    const list = await api('GET', `/api/questions/${raceId}`);
    expect(list.body.data.questions[0].vote_breakdown).toEqual({ in_jurisdiction: 0, in_state: 0, outside: 1, not_stated: 0 });
  });

  it('default order is total votes; sort=local ranks by in-jurisdiction votes', async () => {
    const raceId = await makeRace('sort', { office: 'House', state: 'FL', district: '13' });
    const author = await participant('sort_author', { state: 'FL', district: '13' });
    const brigaded = await ask(raceId, 'Question pushed by people from other states?', author);
    const localQ = await ask(raceId, 'Question local residents actually care about?', author);

    for (let i = 0; i < 4; i++) {
      const outsider = await participant(`sort_out${i}`, { state: 'CA', district: '1' });
      await api('POST', `/api/questions/${brigaded.body.data.id}/vote`, {}, outsider.token);
    }
    for (let i = 0; i < 2; i++) {
      const local = await participant(`sort_in${i}`, { state: 'FL', district: '13' });
      await api('POST', `/api/questions/${localQ.body.data.id}/vote`, {}, local.token);
    }

    const byVotes = await api('GET', `/api/questions/${raceId}`);
    expect(byVotes.body.data.questions[0].id).toBe(brigaded.body.data.id);
    expect(byVotes.body.data.sort).toBe('votes');

    const byLocal = await api('GET', `/api/questions/${raceId}?sort=local`);
    expect(byLocal.body.data.questions[0].id).toBe(localQ.body.data.id);
    expect(byLocal.body.data.sort).toBe('local');
  });

  it('never publishes the author id or the duplicate fingerprint', async () => {
    const raceId = await makeRace('privacy');
    const user = await participant('privacy');
    await ask(raceId, 'What will you do about the hospital closure downtown?', user);
    for (const path of [`/api/questions/${raceId}`, `/api/questions/${raceId}/top`]) {
      const text = JSON.stringify((await api('GET', path)).body);
      expect(text).not.toContain(user.id);
      expect(text).not.toContain('text_fingerprint');
      expect(text).not.toContain('user_id');
    }
  });
});

describe('callout pile-on guard', () => {
  it('stops a seventh callout against one candidate in a day and spends no credit', async () => {
    seq += 1;
    const raceId = await makeRace('pileon', { office: 'Senate', state: 'AZ', district: null });
    const targetId = `cand-pi-target-${seq}`;
    const challengerId = `cand-pi-chal-${seq}`;
    const others = Array.from({ length: 6 }, (_, i) => `cand-pi-o${i}-${seq}`);
    const statements = [targetId, challengerId, ...others].map(id => env.ARENA_DB.prepare(
      `INSERT INTO candidates (id, race_id, name, party, verification_status, credit_balance) VALUES (?, ?, ?, 'Independent', 'verified', 5)`
    ).bind(id, raceId, `PI ${id}`));
    const staff = await participant('pileon_staff');
    // Six callouts from six different campaigns already landed on the target today.
    others.forEach((id, i) => statements.push(env.ARENA_DB.prepare(
      `INSERT INTO challenges (id, race_id, challenger_candidate_id, target_candidate_id, challenge_type, challenge_text, response_deadline, created_by)
       VALUES (?, ?, ?, ?, 'policy_question', ?, datetime('now', '+3 days'), ?)`
    ).bind(`chal-pi-${seq}-${i}`, raceId, id, targetId, `Existing callout ${i} about the budget`, staff.id)));
    statements.push(env.ARENA_DB.prepare(
      `INSERT INTO candidate_staff_links (id, user_id, candidate_id, role) VALUES (?, ?, ?, 'primary')`
    ).bind(`csl-pi-${seq}`, staff.id, challengerId));
    await env.ARENA_DB.batch(statements);

    const res = await api('POST', '/api/challenges', {
      race_id: raceId,
      challenger_candidate_id: challengerId,
      target_candidate_id: targetId,
      challenge_type: 'policy_question',
      challenge_text: 'A seventh callout in one day asking about the water compact vote.',
    }, staff.token);
    expect(res.status).toBe(429);
    expect(res.body.error).toContain('no credit was used');

    const balance = await env.ARENA_DB.prepare(`SELECT credit_balance FROM candidates WHERE id = ?`).bind(challengerId).first();
    expect(balance.credit_balance).toBe(5);

    // Withdrawn callouts do not count toward the cap.
    await env.ARENA_DB.prepare(`UPDATE challenges SET status = 'withdrawn' WHERE id = ?`).bind(`chal-pi-${seq}-0`).run();
    const retry = await api('POST', '/api/challenges', {
      race_id: raceId,
      challenger_candidate_id: challengerId,
      target_candidate_id: targetId,
      challenge_type: 'policy_question',
      challenge_text: 'A callout that fits once an earlier one was withdrawn today.',
    }, staff.token);
    expect(retry.status).toBe(200);
  });
});

describe('fingerprint backfill for older questions', () => {
  it('fingerprints legacy rows, is idempotent, and leaves legacy duplicates public', async () => {
    const raceId = await makeRace('backfill');
    const author = await participant('backfill');
    await env.ARENA_DB.batch(['a', 'b'].map(suffix => env.ARENA_DB.prepare(
      `INSERT INTO questions (id, race_id, user_id, source_type, question_text) VALUES (?, ?, ?, 'voter', 'Legacy duplicate question about zoning?')`
    ).bind(`q-legacy-${seq}-${suffix}`, raceId, author.id)));

    await backfillQuestionFingerprints(env.ARENA_DB);
    await backfillQuestionFingerprints(env.ARENA_DB);

    const rows = await env.ARENA_DB.prepare(
      `SELECT text_fingerprint, status FROM questions WHERE race_id = ? ORDER BY id`
    ).bind(raceId).all();
    expect(rows.results.map(r => r.status)).toEqual(['active', 'active']);
    expect(rows.results.filter(r => r.text_fingerprint)).toHaveLength(1);

    // A new copy of the legacy question is still caught.
    const copy = await ask(raceId, 'legacy duplicate question about zoning', await participant('backfill_copy'));
    expect(copy.status).toBe(409);
  });
});
