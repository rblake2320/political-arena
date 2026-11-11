/**
 * Voting records — real worker, real D1.
 *
 * Proves votes only ever appear on a candidate through an identity link that
 * two different people approved, that a wrong link can be pulled instantly,
 * that imports are idempotent and refuse guessed positions, and that the
 * Congress.gov sync survives hostile or broken provider responses.
 */
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  getCandidateVotingRecord, normalizeVotePosition, parseHouseMemberVotes, syncHouseVotes, upsertRollCall,
} from '../src/voting-records.js';

const BASE = 'https://example.com';
const PASSWORD = 'Str0ng!Passw0rd';
let seq = 0;

async function api(method, path, body, token) {
  seq += 1;
  const headers = { 'CF-Connecting-IP': `198.51.${Math.floor(seq / 250)}.${seq % 250}` };
  const init = { method, headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await SELF.fetch(`${BASE}${path}`, init);
  return { status: res.status, body: await res.json() };
}

async function account(label, role = 'voter') {
  seq += 1;
  const res = await api('POST', '/api/auth/register', {
    email: `vr-${label}-${seq}-${Date.now().toString(36)}@example.com`,
    username: `vr_${label}_${seq}`.slice(0, 30),
    password: PASSWORD,
    display_name: `VR ${label}`,
  });
  expect(res.status).toBe(200);
  const id = res.body.data.user.id;
  await env.ARENA_DB.prepare(`UPDATE users SET email_verified = 1, role = ? WHERE id = ?`).bind(role, id).run();
  return { id, token: res.body.data.token };
}

async function makeCandidate(label, { office = 'House', sourceStatus = 'fec_registered', verification = 'pending' } = {}) {
  seq += 1;
  const raceId = `race-vr-${label}-${seq}`;
  const id = `cand-vr-${label}-${seq}`;
  await env.ARENA_DB.batch([
    env.ARENA_DB.prepare(`INSERT INTO races (id, name, office, state, district) VALUES (?, ?, ?, 'OH', '09')`).bind(raceId, `VR ${label}`, office),
    env.ARENA_DB.prepare(
      `INSERT INTO candidates (id, race_id, name, party, source_status, verification_status) VALUES (?, ?, ?, 'Independent', ?, ?)`
    ).bind(id, raceId, `VR Candidate ${label}`, sourceStatus, verification),
  ]);
  return id;
}

let bioSeq = 0;
const newBioguide = () => `T${String(++bioSeq + 900000).padStart(6, '0')}`;

function rollCallBody(bioguide, { roll = 100 + (++seq), position = 'Yea', chamber = 'house', extraVotes = [] } = {}) {
  return {
    roll_call: {
      chamber,
      congress: 119,
      session: 1,
      roll_number: roll,
      vote_date: '2025-06-12',
      question: 'On Passage',
      result: 'Passed',
      source_name: 'Clerk of the U.S. House',
      source_url: `https://clerk.house.gov/Votes/2025${roll}`,
      bill: { bill_type: 'HR', bill_number: '1234', title: 'Bridge Repair Act' },
    },
    votes: [{ bioguide_id: bioguide, position }, ...extraVotes],
  };
}

const propose = (candidateId, bioguide, token, overrides = {}) => api('POST', '/api/voting-records/identity-links', {
  candidate_id: candidateId,
  identifier_value: bioguide,
  official_name: 'Rep. Test Member',
  match_method: 'official_directory',
  match_confidence: 95,
  evidence_url: `https://bioguide.congress.gov/search/bio/${bioguide}`,
  ...overrides,
}, token);

let admin; let admin2; let moderator; let voter;

beforeAll(async () => {
  await SELF.fetch(`${BASE}/api/health`);
  admin = await account('admin', 'admin');
  admin2 = await account('admin2', 'admin');
  moderator = await account('mod', 'moderator');
  voter = await account('voter');
});

/** Propose (admin) + confirm (admin2) + import one roll call. */
async function linkedCandidateWithVote(label, position = 'Yea') {
  const candidateId = await makeCandidate(label);
  const bioguide = newBioguide();
  const proposed = await propose(candidateId, bioguide, admin.token);
  expect(proposed.status).toBe(200);
  const confirmed = await api('POST', `/api/voting-records/identity-links/${proposed.body.data.id}/review`, { decision: 'confirm', note: 'Directory entry matches district and name.' }, admin2.token);
  expect(confirmed.status).toBe(200);
  const imported = await api('POST', '/api/voting-records/import', rollCallBody(bioguide, { position }), admin.token);
  expect(imported.status).toBe(200);
  return { candidateId, bioguide, linkId: proposed.body.data.id };
}

describe('vote position mapping (pure)', () => {
  it('maps official wording and refuses anything else', () => {
    expect(normalizeVotePosition('Yea')).toBe('yea');
    expect(normalizeVotePosition(' AYE ')).toBe('yea');
    expect(normalizeVotePosition('No')).toBe('nay');
    expect(normalizeVotePosition('Nay')).toBe('nay');
    expect(normalizeVotePosition('Present')).toBe('present');
    expect(normalizeVotePosition('Not Voting')).toBe('not_voting');
    // Speaker elections record a person's name as the "vote": never guess.
    for (const odd of ['Jeffries', 'Johnson (LA)', '', null, undefined, 'maybe', 'yea; DROP TABLE member_votes']) {
      expect(normalizeVotePosition(odd), String(odd)).toBeNull();
    }
  });
});

describe('public record', () => {
  it('shows nothing for a candidate with no confirmed identity and says that is normal', async () => {
    const candidateId = await makeCandidate('challenger');
    const res = await api('GET', `/api/voting-records/candidates/${candidateId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.record_status).toBe('no_record_linked');
    expect(res.body.data.votes).toEqual([]);
    expect(res.body.data.identity).toBeNull();
    expect(res.body.data.note).toContain('normal');
  });

  it('tells the reader governors have no legislative record', async () => {
    const candidateId = await makeCandidate('gov', { office: 'Governor' });
    const res = await api('GET', `/api/voting-records/candidates/${candidateId}`);
    expect(res.body.data.note).toContain('Governors do not cast legislative votes');
  });

  it('shows source-attributed votes once two people confirmed the identity', async () => {
    const { candidateId, bioguide } = await linkedCandidateWithVote('incumbent', 'Nay');
    const res = await api('GET', `/api/voting-records/candidates/${candidateId}`);
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.record_status).toBe('available');
    expect(data.identity.identifier_value).toBe(bioguide);
    expect(data.identity.evidence_url).toContain(bioguide);
    expect(data.summary).toEqual({ total: 1, yea: 0, nay: 1, present: 0, not_voting: 0 });
    const [vote] = data.votes;
    expect(vote.position).toBe('nay');
    expect(vote.raw_position).toBe('Nay');
    expect(vote.source_url).toMatch(/^https:\/\/clerk\.house\.gov\//);
    expect(vote.source_name).toBeTruthy();
    expect(vote.retrieved_at).toBeTruthy();
    expect(vote.bill).toMatchObject({ bill_type: 'hr', bill_number: '1234', title: 'Bridge Repair Act' });
    // Attributed, never characterized: no score or verdict fields on a vote.
    expect(Object.keys(vote).some(k => /score|rating|verdict|grade/i.test(k))).toBe(false);
    expect(data.disclaimer).toContain('does not characterize');
    expect(data.report_error.reason).toBe('identity_error');
  });

  it('404s for unknown candidates and unverified self-registered profiles', async () => {
    expect((await api('GET', '/api/voting-records/candidates/nope')).status).toBe(404);
    const hidden = await makeCandidate('claim', { sourceStatus: 'platform_claim', verification: 'pending' });
    expect((await api('GET', `/api/voting-records/candidates/${hidden}`)).status).toBe(404);
  });
});

describe('identity link: two-person rule', () => {
  it('a proposed link exposes no votes until someone else confirms it', async () => {
    const candidateId = await makeCandidate('pending');
    const bioguide = newBioguide();
    await api('POST', '/api/voting-records/import', rollCallBody(bioguide), admin.token);
    const proposed = await propose(candidateId, bioguide, admin.token);
    expect(proposed.status).toBe(200);

    const before = await api('GET', `/api/voting-records/candidates/${candidateId}`);
    expect(before.body.data.record_status).toBe('no_record_linked');
    expect(JSON.stringify(before.body)).not.toContain(bioguide);
  });

  it('the proposer cannot confirm their own link, by any route', async () => {
    const candidateId = await makeCandidate('self');
    const proposed = await propose(candidateId, newBioguide(), admin.token);
    const self = await api('POST', `/api/voting-records/identity-links/${proposed.body.data.id}/review`, { decision: 'confirm', note: 'Confirming my own proposal.' }, admin.token);
    expect(self.status).toBe(403);
    const row = await env.ARENA_DB.prepare(`SELECT status FROM candidate_identity_links WHERE id = ?`).bind(proposed.body.data.id).first();
    expect(row.status).toBe('proposed');

    const queue = await api('GET', '/api/voting-records/identity-links?status=proposed', undefined, admin.token);
    expect(queue.body.data.links.find(l => l.id === proposed.body.data.id).can_review).toBe(false);
    const otherQueue = await api('GET', '/api/voting-records/identity-links?status=proposed', undefined, moderator.token);
    expect(otherQueue.body.data.links.find(l => l.id === proposed.body.data.id).can_review).toBe(true);
  });

  it('a rejected link stays hidden and a new proposal can follow', async () => {
    const candidateId = await makeCandidate('reject');
    const first = await propose(candidateId, newBioguide(), admin.token);
    const rejected = await api('POST', `/api/voting-records/identity-links/${first.body.data.id}/review`, { decision: 'reject', note: 'Different person with the same name.' }, moderator.token);
    expect(rejected.status).toBe(200);
    expect((await api('GET', `/api/voting-records/candidates/${candidateId}`)).body.data.record_status).toBe('no_record_linked');
    expect((await propose(candidateId, newBioguide(), admin.token)).status).toBe(200);
  });

  it('only one live link per candidate; a decided link cannot be decided again', async () => {
    const candidateId = await makeCandidate('single');
    const first = await propose(candidateId, newBioguide(), admin.token);
    expect((await propose(candidateId, newBioguide(), admin2.token)).status).toBe(409);

    const review = body => api('POST', `/api/voting-records/identity-links/${first.body.data.id}/review`, body, admin2.token);
    expect((await review({ decision: 'confirm', note: 'Matches official directory.' })).status).toBe(200);
    expect((await review({ decision: 'reject', note: 'Changing my mind after confirm.' })).status).toBe(409);
  });

  it('two reviewers racing produce exactly one decision', async () => {
    const candidateId = await makeCandidate('race');
    const proposed = await propose(candidateId, newBioguide(), admin.token);
    const path = `/api/voting-records/identity-links/${proposed.body.data.id}/review`;
    const results = await Promise.all([
      api('POST', path, { decision: 'confirm', note: 'Confirming from reviewer one.' }, admin2.token),
      api('POST', path, { decision: 'reject', note: 'Rejecting from reviewer two.' }, moderator.token),
    ]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    const audit = await env.ARENA_DB.prepare(
      `SELECT COUNT(*) as cnt FROM audit_log WHERE entity_type = 'candidate_identity_link' AND entity_id = ? AND action IN ('identity_link.confirm','identity_link.reject')`
    ).bind(proposed.body.data.id).first();
    expect(audit.cnt).toBe(1);
  });

  it('revoking a wrong link hides the votes at once and needs only one person', async () => {
    const { candidateId, linkId } = await linkedCandidateWithVote('revoke');
    expect((await api('GET', `/api/voting-records/candidates/${candidateId}`)).body.data.record_status).toBe('available');

    const revoked = await api('POST', `/api/voting-records/identity-links/${linkId}/revoke`, { note: 'Wrong person: same name, different state.' }, moderator.token);
    expect(revoked.status).toBe(200);

    const after = await api('GET', `/api/voting-records/candidates/${candidateId}`);
    expect(after.body.data.record_status).toBe('no_record_linked');
    expect(after.body.data.votes).toEqual([]);
    // The votes themselves are not deleted: they belong to the official record, not the candidate.
    const kept = await env.ARENA_DB.prepare(`SELECT COUNT(*) as cnt FROM member_votes`).first();
    expect(kept.cnt).toBeGreaterThan(0);
    expect((await api('POST', `/api/voting-records/identity-links/${linkId}/revoke`, { note: 'Revoking a second time.' }, moderator.token)).status).toBe(404);
  });

  it('writes propose, confirm and revoke to the audit chain', async () => {
    const { linkId } = await linkedCandidateWithVote('audit');
    await api('POST', `/api/voting-records/identity-links/${linkId}/revoke`, { note: 'Audit trail check revoke.' }, admin.token);
    const rows = await env.ARENA_DB.prepare(
      `SELECT action, chain_seq FROM audit_log WHERE entity_type = 'candidate_identity_link' AND entity_id = ? ORDER BY chain_seq`
    ).bind(linkId).all();
    expect(rows.results.map(r => r.action)).toEqual(['identity_link.propose', 'identity_link.confirm', 'identity_link.revoke']);
    expect(rows.results.map(r => r.chain_seq)).toEqual([1, 2, 3]);
  });
});

describe('authorization', () => {
  it('voters and anonymous users cannot propose, review, revoke, import, sync or read the queue', async () => {
    const candidateId = await makeCandidate('authz');
    const bioguide = newBioguide();
    for (const token of [undefined, voter.token]) {
      const expected = token ? 403 : 401;
      expect((await propose(candidateId, bioguide, token)).status).toBe(expected);
      expect((await api('GET', '/api/voting-records/identity-links', undefined, token)).status).toBe(expected);
      expect((await api('POST', '/api/voting-records/identity-links/x/review', { decision: 'confirm', note: 'no access' }, token)).status).toBe(expected);
      expect((await api('POST', '/api/voting-records/identity-links/x/revoke', { note: 'no access' }, token)).status).toBe(expected);
      expect((await api('POST', '/api/voting-records/import', rollCallBody(bioguide), token)).status).toBe(expected);
      expect((await api('POST', '/api/voting-records/sync', { congress: 119, session: 1 }, token)).status).toBe(expected);
    }
    // Moderators review identity but do not load data.
    expect((await api('POST', '/api/voting-records/import', rollCallBody(bioguide), moderator.token)).status).toBe(403);
  });
});

describe('validation', () => {
  it('rejects malformed identifiers, non-http evidence and out-of-range confidence', async () => {
    const candidateId = await makeCandidate('valid');
    for (const overrides of [
      { identifier_value: 'not-an-id' },
      { identifier_value: "A000001' OR '1'='1" },
      { evidence_url: 'javascript:alert(1)' },
      { evidence_url: 'ftp://example.org/file' },
      { match_confidence: 101 },
      { match_confidence: -1 },
      { match_method: 'vibes' },
      { official_name: '' },
    ]) {
      const res = await propose(candidateId, newBioguide(), admin.token, overrides);
      expect(res.status, JSON.stringify(overrides)).toBe(400);
    }
    expect((await propose('missing-candidate', newBioguide(), admin.token)).status).toBe(404);
  });

  it('normalizes a lowercase bioguide id rather than storing two spellings', async () => {
    const candidateId = await makeCandidate('case');
    const bioguide = newBioguide();
    const res = await propose(candidateId, bioguide.toLowerCase(), admin.token);
    expect(res.status).toBe(200);
    const row = await env.ARENA_DB.prepare(`SELECT identifier_value FROM candidate_identity_links WHERE id = ?`).bind(res.body.data.id).first();
    expect(row.identifier_value).toBe(bioguide);
  });

  it('refuses an import with a guessed position, a duplicate member, or a bad source', async () => {
    const bioguide = newBioguide();
    const guessed = await api('POST', '/api/voting-records/import', rollCallBody(bioguide, { position: 'Probably yes' }), admin.token);
    expect(guessed.status).toBe(400);
    expect(guessed.body.error).toContain('Unrecognized vote position');

    const dup = await api('POST', '/api/voting-records/import', rollCallBody(bioguide, { extraVotes: [{ bioguide_id: bioguide, position: 'Nay' }] }), admin.token);
    expect(dup.status).toBe(400);

    const bad = rollCallBody(bioguide);
    bad.roll_call.source_url = 'javascript:alert(1)';
    expect((await api('POST', '/api/voting-records/import', bad, admin.token)).status).toBe(400);

    const noDate = rollCallBody(bioguide);
    noDate.roll_call.vote_date = '06/12/2025';
    expect((await api('POST', '/api/voting-records/import', noDate, admin.token)).status).toBe(400);

    // Nothing from the refused imports was written.
    const rows = await env.ARENA_DB.prepare(`SELECT COUNT(*) as cnt FROM member_votes WHERE identifier_value = ?`).bind(bioguide).first();
    expect(rows.cnt).toBe(0);
  });
});

describe('import idempotency', () => {
  it('re-importing a roll call updates in place and never duplicates a vote', async () => {
    const { candidateId, bioguide } = await linkedCandidateWithVote('idem');
    const body = rollCallBody(bioguide, { roll: 7777, position: 'Yea' });
    for (let i = 0; i < 3; i++) expect((await api('POST', '/api/voting-records/import', body, admin.token)).status).toBe(200);

    // The source corrects the vote: the stored record follows the source.
    body.votes[0].position = 'Not Voting';
    body.roll_call.result = 'Failed';
    expect((await api('POST', '/api/voting-records/import', body, admin.token)).status).toBe(200);

    const record = (await api('GET', `/api/voting-records/candidates/${candidateId}`)).body.data;
    const matches = record.votes.filter(v => v.roll_number === 7777);
    expect(matches).toHaveLength(1);
    expect(matches[0].position).toBe('not_voting');
    expect(matches[0].result).toBe('Failed');
    const rollCalls = await env.ARENA_DB.prepare(`SELECT COUNT(*) as cnt FROM roll_calls WHERE roll_number = 7777`).first();
    expect(rollCalls.cnt).toBe(1);
  });

  it('keeps House and Senate roll calls with the same number separate', async () => {
    const bioguide = newBioguide();
    const house = rollCallBody(bioguide, { roll: 8888, chamber: 'house', position: 'Yea' });
    const senate = rollCallBody(bioguide, { roll: 8888, chamber: 'senate', position: 'Nay' });
    senate.roll_call.source_url = 'https://www.senate.gov/legislative/LIS/roll_call_votes/vote1191/vote_119_1_08888.htm';
    expect((await api('POST', '/api/voting-records/import', house, admin.token)).status).toBe(200);
    expect((await api('POST', '/api/voting-records/import', senate, admin.token)).status).toBe(200);
    const rows = await env.ARENA_DB.prepare(`SELECT chamber FROM roll_calls WHERE roll_number = 8888 ORDER BY chamber`).all();
    expect(rows.results.map(r => r.chamber)).toEqual(['house', 'senate']);
  });

  it('paginates and orders newest first', async () => {
    const { candidateId, bioguide } = await linkedCandidateWithVote('page');
    for (const [roll, date] of [[9001, '2025-01-10'], [9002, '2025-03-10'], [9003, '2025-02-10']]) {
      const body = rollCallBody(bioguide, { roll });
      body.roll_call.vote_date = date;
      await api('POST', '/api/voting-records/import', body, admin.token);
    }
    const page = (await api('GET', `/api/voting-records/candidates/${candidateId}?limit=2&page=1`)).body.data;
    expect(page.votes).toHaveLength(2);
    expect(page.pagination.total).toBe(4);
    const dates = page.votes.map(v => v.vote_date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});

describe('Congress.gov sync', () => {
  const memberPayload = (roll, results) => ({
    houseRollCallVoteMemberVotes: {
      congress: 119, sessionNumber: 1, rollCallNumber: roll, startDate: '2025-07-01T14:02:00-04:00',
      voteQuestion: 'On Passage', voteType: 'Yea-and-Nay', result: 'Passed',
      legislationType: 'HR', legislationNumber: '55', legislationUrl: 'https://congress.gov/bill/119/house-bill/55',
      results,
    },
  });
  const jsonResponse = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const testEnv = extra => ({ ARENA_DB: env.ARENA_DB, CONGRESS_API_KEY: 'test-key-not-real', ...extra });

  it('reports not configured without a key and makes no request', async () => {
    let called = false;
    const outcome = await syncHouseVotes({ ARENA_DB: env.ARENA_DB }, { congress: 119, session: 1 }, async () => { called = true; });
    expect(outcome.configured).toBe(false);
    expect(called).toBe(false);
    expect((await api('POST', '/api/voting-records/sync', { congress: 119, session: 1 }, admin.token)).status).toBe(503);
  });

  it('parses the documented response, with either spelling of the member id', async () => {
    const parsed = parseHouseMemberVotes(memberPayload(321, [
      { bioguideID: 'A000001', voteCast: 'Yea' },
      { bioguideId: 'B000002', voteCast: 'Nay' },
    ]));
    expect(parsed.rollCall).toMatchObject({ chamber: 'house', congress: 119, session: 1, roll_number: 321, vote_date: '2025-07-01', result: 'Passed' });
    expect(parsed.rollCall.source_url).toBe('https://clerk.house.gov/Votes/2025321');
    expect(parsed.rollCall.bill).toMatchObject({ bill_type: 'HR', bill_number: '55' });
    expect(parsed.memberVotes).toEqual([{ bioguide_id: 'A000001', position: 'Yea' }, { bioguide_id: 'B000002', position: 'Nay' }]);
    for (const bad of [null, {}, { houseRollCallVoteMemberVotes: {} }, { houseRollCallVoteMemberVotes: { congress: 119, sessionNumber: 1, rollCallNumber: 'x', startDate: 'yesterday' } }]) {
      expect(parseHouseMemberVotes(bad)).toBeNull();
    }
  });

  it('stores votes, skips unrecognized positions and bad ids, and sends a timeout signal', async () => {
    const good = newBioguide();
    const speakerVote = newBioguide();
    const signals = [];
    const fetchImpl = async (url, init) => {
      signals.push(init?.signal);
      if (url.includes('/members')) {
        return jsonResponse(memberPayload(4001, [
          { bioguideID: good, voteCast: 'Aye' },
          { bioguideID: speakerVote, voteCast: 'Jeffries' },
          { bioguideID: '<script>', voteCast: 'Yea' },
          { bioguideID: good, voteCast: 'Nay' }, // duplicate member: first one wins
        ]));
      }
      return jsonResponse({ houseRollCallVotes: [{ rollCallNumber: 4001 }] });
    };

    const outcome = await syncHouseVotes(testEnv(), { congress: 119, session: 1, limit: 5 }, fetchImpl);
    expect(outcome).toMatchObject({ configured: true, roll_calls: 1, votes_written: 1, failures: [] });
    expect(signals.every(s => s instanceof AbortSignal)).toBe(true);

    const rows = await env.ARENA_DB.prepare(
      `SELECT mv.identifier_value, mv.vote_position FROM member_votes mv JOIN roll_calls rc ON mv.roll_call_id = rc.id WHERE rc.roll_number = 4001`
    ).all();
    expect(rows.results).toEqual([{ identifier_value: good, vote_position: 'yea' }]);
  });

  it('one broken roll call does not stop the others, and errors never contain the API key', async () => {
    const member = newBioguide();
    const fetchImpl = async url => {
      if (url.includes('/4101/members')) return new Response('upstream exploded', { status: 500 });
      if (url.includes('/4102/members')) return new Response('<html>not json</html>', { status: 200 });
      if (url.includes('/4103/members')) return jsonResponse({ unexpected: true });
      if (url.includes('/4104/members')) return jsonResponse(memberPayload(4104, [{ bioguideID: member, voteCast: 'Present' }]));
      return jsonResponse({ houseRollCallVotes: [4101, 4102, 4103, 4104].map(n => ({ rollCallNumber: n })) });
    };
    const outcome = await syncHouseVotes(testEnv(), { congress: 119, session: 1 }, fetchImpl);
    expect(outcome.roll_calls).toBe(1);
    expect(outcome.votes_written).toBe(1);
    expect(outcome.failures).toHaveLength(3);
    expect(JSON.stringify(outcome)).not.toContain('test-key-not-real');
  });

  it('a failing list request throws without the key in the message and writes nothing', async () => {
    const before = await env.ARENA_DB.prepare(`SELECT COUNT(*) as cnt FROM roll_calls`).first();
    await expect(syncHouseVotes(testEnv(), { congress: 119, session: 1 }, async () => new Response('forbidden', { status: 403 })))
      .rejects.toThrow(/HTTP 403/);
    await expect(syncHouseVotes(testEnv(), { congress: 119, session: 1 }, async () => { throw new Error('network down'); }))
      .rejects.not.toThrow(/test-key-not-real/);
    const after = await env.ARENA_DB.prepare(`SELECT COUNT(*) as cnt FROM roll_calls`).first();
    expect(after.cnt).toBe(before.cnt);
  });

  it('synced roll calls are idempotent across repeated runs', async () => {
    const member = newBioguide();
    const fetchImpl = async url => (url.includes('/members')
      ? jsonResponse(memberPayload(4201, [{ bioguideID: member, voteCast: 'No' }]))
      : jsonResponse({ houseRollCallVotes: { item: [{ rollCallNumber: 4201 }] } }));
    for (let i = 0; i < 3; i++) await syncHouseVotes(testEnv(), { congress: 119, session: 1 }, fetchImpl);
    const rows = await env.ARENA_DB.prepare(`SELECT COUNT(*) as cnt FROM member_votes WHERE identifier_value = ?`).bind(member).first();
    expect(rows.cnt).toBe(1);
  });
});

describe('module-level guarantees', () => {
  it('upsertRollCall reports what it skipped', async () => {
    const outcome = await upsertRollCall(env.ARENA_DB, {
      chamber: 'house', congress: 119, session: 2, roll_number: 5001, vote_date: '2026-02-02', question: 'On Agreeing to the Amendment',
      source_name: 'Clerk of the U.S. House', source_url: 'https://clerk.house.gov/Votes/20265001',
    }, [
      { bioguide_id: newBioguide(), position: 'Yea' },
      { bioguide_id: 'bad', position: 'Yea' },
      { bioguide_id: newBioguide(), position: 'Abstain-ish' },
    ]);
    expect(outcome).toMatchObject({ votes_written: 1, skipped_positions: 1, skipped_identifiers: 1 });
  });

  it('a linked candidate with no loaded votes is reported as such, not as empty truth', async () => {
    const candidateId = await makeCandidate('nolines');
    const proposed = await propose(candidateId, newBioguide(), admin.token);
    await api('POST', `/api/voting-records/identity-links/${proposed.body.data.id}/review`, { decision: 'confirm', note: 'Confirmed against directory.' }, admin2.token);
    const record = await getCandidateVotingRecord(env.ARENA_DB, candidateId);
    expect(record.record_status).toBe('linked_no_votes_loaded');
    expect(record.note).toContain('no roll calls have been loaded');
  });
});
