/**
 * Arena — Legislative voting records (public-sourced, incumbents only)
 *
 * Votes are reproduced from an official source and attributed to it. The
 * platform asserts nothing about them: no score, no clock, no
 * characterization. A candidate shows a record only through a CONFIRMED
 * identity link (two different reviewers), because attaching one person's
 * votes to another person is the worst error this feature can make.
 *
 * Federal House roll calls come from the Congress.gov API (CONGRESS_API_KEY).
 * The Senate is not in that API; Senate votes enter through the manual import
 * with a source link to senate.gov.
 */

import { generateId } from './db.js';

export const BIOGUIDE_PATTERN = /^[A-Z]\d{6}$/;
const CONGRESS_API_BASE = 'https://api.congress.gov/v3';
const FETCH_TIMEOUT_MS = 15000;
// 5 bound parameters per vote row; 19 rows = 95, under D1's limit of 100 per statement.
const VOTE_ROWS_PER_STATEMENT = 19;

const POSITION_MAP = new Map([
  ['yea', 'yea'], ['aye', 'yea'], ['yes', 'yea'],
  ['nay', 'nay'], ['no', 'nay'],
  ['present', 'present'],
  ['not voting', 'not_voting'], ['not_voting', 'not_voting'], ['absent', 'not_voting'],
]);

/**
 * Map a source's wording to one of four positions. Returns null for anything
 * else (for example a Speaker election, where the "vote" is a person's name),
 * so an unrecognized value is skipped and counted instead of guessed.
 */
export function normalizeVotePosition(raw) {
  return POSITION_MAP.get(String(raw || '').trim().toLowerCase()) || null;
}

function rollCallId({ chamber, congress, session, roll_number }) {
  return `rc-${chamber}-${congress}-${session}-${roll_number}`;
}

function billId({ congress, bill_type, bill_number }) {
  return `bill-${congress}-${String(bill_type).toLowerCase()}-${bill_number}`;
}

/**
 * Store one roll call and its member votes. Idempotent: re-importing the same
 * roll call updates it in place and never duplicates a member's vote.
 * @returns {Promise<{roll_call_id: string, votes_written: number, skipped_positions: number, skipped_identifiers: number}>}
 */
export async function upsertRollCall(db, rollCall, memberVotes, { importedBy = null } = {}) {
  const id = rollCallId(rollCall);
  const retrievedAt = rollCall.retrieved_at || new Date().toISOString();
  const statements = [];

  let storedBillId = null;
  if (rollCall.bill) {
    storedBillId = billId({ congress: rollCall.congress, ...rollCall.bill });
    statements.push(db.prepare(
      `INSERT INTO bills (id, congress, bill_type, bill_number, title, source_name, source_url, retrieved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(congress, bill_type, bill_number) DO UPDATE SET
         title = COALESCE(excluded.title, bills.title),
         source_name = excluded.source_name, source_url = excluded.source_url,
         retrieved_at = excluded.retrieved_at, updated_at = datetime('now')`
    ).bind(
      storedBillId, rollCall.congress, String(rollCall.bill.bill_type).toLowerCase(), String(rollCall.bill.bill_number),
      rollCall.bill.title || null, rollCall.source_name, rollCall.bill.source_url || rollCall.source_url, retrievedAt,
    ));
  }

  statements.push(db.prepare(
    `INSERT INTO roll_calls
       (id, chamber, congress, session, roll_number, vote_date, question, description, result, bill_id,
        source_name, source_url, retrieved_at, imported_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(chamber, congress, session, roll_number) DO UPDATE SET
       vote_date = excluded.vote_date, question = excluded.question, description = excluded.description,
       result = excluded.result, bill_id = excluded.bill_id, source_name = excluded.source_name,
       source_url = excluded.source_url, retrieved_at = excluded.retrieved_at, updated_at = datetime('now')`
  ).bind(
    id, rollCall.chamber, rollCall.congress, rollCall.session, rollCall.roll_number, rollCall.vote_date,
    rollCall.question, rollCall.description || null, rollCall.result || null, storedBillId,
    rollCall.source_name, rollCall.source_url, retrievedAt, importedBy,
  ));

  let skippedPositions = 0;
  let skippedIdentifiers = 0;
  const seen = new Set();
  const rows = [];
  for (const vote of memberVotes) {
    const bioguide = String(vote.bioguide_id || '').trim().toUpperCase();
    if (!BIOGUIDE_PATTERN.test(bioguide) || seen.has(bioguide)) { skippedIdentifiers += 1; continue; }
    const position = normalizeVotePosition(vote.position);
    if (!position) { skippedPositions += 1; continue; }
    seen.add(bioguide);
    rows.push([generateId('mv'), id, bioguide, position, String(vote.position).trim().slice(0, 60)]);
  }

  // Multi-row inserts keep a full chamber (435+ votes) to a few dozen
  // statements, each under D1's 100-bound-parameter limit.
  for (let i = 0; i < rows.length; i += VOTE_ROWS_PER_STATEMENT) {
    const chunk = rows.slice(i, i + VOTE_ROWS_PER_STATEMENT);
    statements.push(db.prepare(
      `INSERT INTO member_votes (id, roll_call_id, identifier_type, identifier_value, vote_position, raw_position)
       VALUES ${chunk.map(() => "(?, ?, 'bioguide', ?, ?, ?)").join(', ')}
       ON CONFLICT(roll_call_id, identifier_type, identifier_value) DO UPDATE SET
         vote_position = excluded.vote_position, raw_position = excluded.raw_position, updated_at = datetime('now')`
    ).bind(...chunk.flat()));
  }

  // ONE batch = one transaction: the roll call, its bill and every member vote
  // commit together or not at all. A reader never sees half an import, and a
  // failed re-import leaves the previous version intact.
  await db.batch(statements);

  return { roll_call_id: id, votes_written: seen.size, skipped_positions: skippedPositions, skipped_identifiers: skippedIdentifiers };
}

// ---------- Congress.gov (House) ----------

async function congressGet(env, path, fetchImpl) {
  const url = new URL(`${env.CONGRESS_API_URL || CONGRESS_API_BASE}${path}`);
  url.searchParams.set('format', 'json');
  url.searchParams.set('api_key', env.CONGRESS_API_KEY);
  const response = await fetchImpl(url.toString(), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  // Never echo the URL or body in errors: the URL carries the API key.
  if (!response.ok) throw new Error(`Congress.gov returned HTTP ${response.status} for ${path}`);
  try {
    return await response.json();
  } catch {
    throw new Error(`Congress.gov returned a non-JSON response for ${path}`);
  }
}

function listOf(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.item)) return value.item;
  return [];
}

/** Turn the documented member-votes response into our roll call shape; null if essentials are missing. */
export function parseHouseMemberVotes(payload) {
  const vote = payload?.houseRollCallVoteMemberVotes;
  if (!vote) return null;
  const congress = Number(vote.congress);
  const session = Number(vote.sessionNumber);
  const rollNumber = Number(vote.rollCallNumber);
  const voteDate = String(vote.startDate || '').slice(0, 10);
  if (!Number.isInteger(congress) || !Number.isInteger(session) || !Number.isInteger(rollNumber) || !/^\d{4}-\d{2}-\d{2}$/.test(voteDate)) {
    return null;
  }
  const year = voteDate.slice(0, 4);
  const hasBill = vote.legislationType && vote.legislationNumber;
  return {
    rollCall: {
      chamber: 'house',
      congress,
      session,
      roll_number: rollNumber,
      vote_date: voteDate,
      question: String(vote.voteQuestion || vote.voteType || 'Roll call vote').slice(0, 500),
      description: vote.voteType ? String(vote.voteType).slice(0, 500) : null,
      result: vote.result ? String(vote.result).slice(0, 120) : null,
      bill: hasBill ? {
        bill_type: String(vote.legislationType).replace(/\s+/g, ''),
        bill_number: String(vote.legislationNumber),
        source_url: vote.legislationUrl || null,
      } : null,
      source_name: 'Clerk of the U.S. House via Congress.gov',
      // The Clerk's public page for this roll call: a human-checkable source.
      source_url: `https://clerk.house.gov/Votes/${year}${rollNumber}`,
    },
    memberVotes: listOf(vote.results).map(m => ({ bioguide_id: m.bioguideID || m.bioguideId, position: m.voteCast })),
  };
}

/**
 * Pull recent House roll calls and store them.
 * @returns {Promise<{configured: boolean, roll_calls: number, votes_written: number, failures: string[]}>}
 */
export async function syncHouseVotes(env, { congress, session, limit = 20 } = {}, fetchImpl = fetch) {
  if (!env.CONGRESS_API_KEY) return { configured: false, roll_calls: 0, votes_written: 0, failures: [] };

  const list = await congressGet(env, `/house-vote/${congress}/${session}?limit=${Math.min(Math.max(limit, 1), 50)}`, fetchImpl);
  const numbers = listOf(list?.houseRollCallVotes)
    .map(v => Number(v.rollCallNumber))
    .filter(Number.isInteger);

  let rollCalls = 0;
  let votesWritten = 0;
  const failures = [];
  for (const number of numbers) {
    try {
      const parsed = parseHouseMemberVotes(await congressGet(env, `/house-vote/${congress}/${session}/${number}/members`, fetchImpl));
      if (!parsed) { failures.push(`roll call ${number}: unrecognized response`); continue; }
      const stored = await upsertRollCall(env.ARENA_DB, parsed.rollCall, parsed.memberVotes);
      rollCalls += 1;
      votesWritten += stored.votes_written;
    } catch (error) {
      // One bad roll call must not stop the rest of the sync.
      failures.push(`roll call ${number}: ${error.message}`);
    }
  }
  return { configured: true, roll_calls: rollCalls, votes_written: votesWritten, failures };
}

// ---------- public read ----------

const NOT_APPLICABLE = {
  Governor: 'Governors do not cast legislative votes, so no voting record applies to this office.',
  Mayor: 'Mayors do not cast congressional votes, so no federal voting record applies to this office.',
};

export async function getCandidateVotingRecord(db, candidateId, { limit = 20, offset = 0 } = {}) {
  const candidate = await db.prepare(
    `SELECT c.id, c.name, r.office FROM candidates c JOIN races r ON c.race_id = r.id
     WHERE c.id = ? AND c.is_active = 1
       AND NOT (c.source_status = 'platform_claim' AND c.verification_status != 'verified')`
  ).bind(candidateId).first();
  if (!candidate) return null;

  const base = {
    candidate: { id: candidate.id, name: candidate.name },
    disclaimer: 'Votes are reproduced from the cited official source. The platform does not characterize or score them.',
    report_error: {
      how: 'If this record belongs to a different person or a vote is wrong, file a correction on this candidate.',
      content_type: 'candidate',
      content_id: candidate.id,
      reason: 'identity_error',
    },
  };

  const link = await db.prepare(
    `SELECT identifier_type, identifier_value, official_name, match_method, match_confidence, evidence_url, reviewed_at
     FROM candidate_identity_links WHERE candidate_id = ? AND status = 'confirmed' LIMIT 1`
  ).bind(candidateId).first();

  if (!link) {
    return {
      ...base,
      record_status: 'no_record_linked',
      note: NOT_APPLICABLE[candidate.office]
        || 'No official voting record is linked to this candidate. Candidates who have not held legislative office have none. That is normal and not a mark against them.',
      identity: null,
      summary: { total: 0, yea: 0, nay: 0, present: 0, not_voting: 0 },
      votes: [],
      pagination: { limit, offset, total: 0 },
    };
  }

  const [summaryRows, votesResult] = await Promise.all([
    db.prepare(
      `SELECT vote_position, COUNT(*) as cnt FROM member_votes
       WHERE identifier_type = ? AND identifier_value = ? GROUP BY vote_position`
    ).bind(link.identifier_type, link.identifier_value).all(),
    db.prepare(
      `SELECT rc.id as roll_call_id, rc.chamber, rc.congress, rc.session, rc.roll_number, rc.vote_date,
              rc.question, rc.description, rc.result, rc.source_name, rc.source_url, rc.retrieved_at,
              mv.vote_position as position, mv.raw_position,
              b.bill_type, b.bill_number, b.title as bill_title, b.source_url as bill_source_url
       FROM member_votes mv
       JOIN roll_calls rc ON mv.roll_call_id = rc.id
       LEFT JOIN bills b ON rc.bill_id = b.id
       WHERE mv.identifier_type = ? AND mv.identifier_value = ?
       ORDER BY rc.vote_date DESC, rc.roll_number DESC
       LIMIT ? OFFSET ?`
    ).bind(link.identifier_type, link.identifier_value, limit, offset).all(),
  ]);

  const summary = { total: 0, yea: 0, nay: 0, present: 0, not_voting: 0 };
  for (const row of summaryRows.results || []) {
    if (row.vote_position in summary) summary[row.vote_position] = row.cnt;
    summary.total += row.cnt;
  }

  return {
    ...base,
    record_status: summary.total > 0 ? 'available' : 'linked_no_votes_loaded',
    note: summary.total > 0
      ? 'Coverage is limited to the roll calls loaded so far. It is not a complete voting history.'
      : 'This candidate is matched to an official record, but no roll calls have been loaded yet.',
    identity: {
      identifier_type: link.identifier_type,
      identifier_value: link.identifier_value,
      official_name: link.official_name,
      match_method: link.match_method,
      match_confidence: link.match_confidence,
      evidence_url: link.evidence_url,
      confirmed_at: link.reviewed_at,
    },
    summary,
    votes: (votesResult.results || []).map(v => ({
      roll_call_id: v.roll_call_id, chamber: v.chamber, congress: v.congress, session: v.session,
      roll_number: v.roll_number, vote_date: v.vote_date, question: v.question, description: v.description,
      result: v.result, position: v.position, raw_position: v.raw_position,
      bill: v.bill_number ? { bill_type: v.bill_type, bill_number: v.bill_number, title: v.bill_title, source_url: v.bill_source_url } : null,
      source_name: v.source_name, source_url: v.source_url, retrieved_at: v.retrieved_at,
    })),
    pagination: { limit, offset, total: summary.total },
  };
}
