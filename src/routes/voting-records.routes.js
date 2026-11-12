/**
 * Arena — Voting record routes
 * Public read of source-attributed legislative votes, plus the staff workflow
 * that decides WHICH official record belongs to a candidate.
 *
 * Identity links need two different people: one proposes with evidence, a
 * second confirms. Revoking is immediate and needs only one, because taking
 * down a possibly wrong attribution must never wait.
 */

import { Router } from 'itty-router';
import { generateId } from '../db.js';
import { auditLogNow } from '../audit.js';
import { errorResponse, getClientIP, parseBody, parsePagination, requireRole, successResponse } from '../middleware.js';
import {
  importRollCallSchema, proposeIdentityLinkSchema, reviewIdentityLinkSchema, revokeIdentityLinkSchema,
  syncHouseVotesSchema, validate,
} from '../validation.js';
import { getCandidateVotingRecord, normalizeVotePosition, syncHouseVotes, upsertRollCall } from '../voting-records.js';

const router = Router({ base: '/api/voting-records' });
const REVIEWERS = ['moderator', 'admin', 'super_admin'];
const ADMINS = ['admin', 'super_admin'];

// GET /api/voting-records/candidates/:id — public, source-attributed record
router.get('/candidates/:id', async (request, env) => {
  const { limit, offset } = parsePagination(new URL(request.url));
  const record = await getCandidateVotingRecord(env.ARENA_DB, request.params.id, { limit, offset });
  if (!record) return errorResponse('Candidate not found', 404);
  return successResponse(record);
});

// GET /api/voting-records/identity-links?status=proposed — review queue
router.get('/identity-links', async (request, env) => {
  const authError = await requireRole(...REVIEWERS)(request, env);
  if (authError) return authError;

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'proposed';
  if (!['proposed', 'confirmed', 'rejected', 'revoked'].includes(status)) return errorResponse('Invalid status', 400);
  const { limit, offset } = parsePagination(url);

  const result = await env.ARENA_DB.prepare(
    `SELECT l.*, c.name as candidate_name, c.party as candidate_party, r.name as race_name, r.office as race_office,
            r.state as race_state, r.district as race_district, pu.display_name as proposed_by_name,
            (SELECT COUNT(*) FROM member_votes mv WHERE mv.identifier_type = l.identifier_type AND mv.identifier_value = l.identifier_value) as loaded_votes
     FROM candidate_identity_links l
     JOIN candidates c ON l.candidate_id = c.id
     JOIN races r ON c.race_id = r.id
     JOIN users pu ON l.proposed_by = pu.id
     WHERE l.status = ?
     ORDER BY l.created_at ASC LIMIT ? OFFSET ?`
  ).bind(status, limit, offset).all();

  return successResponse({
    links: (result.results || []).map(link => ({ ...link, can_review: link.proposed_by !== request.user.id })),
  });
});

// POST /api/voting-records/identity-links — propose that a candidate is a given official
router.post('/identity-links', async (request, env) => {
  const authError = await requireRole(...REVIEWERS)(request, env);
  if (authError) return authError;

  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid request body');
  const { valid, errors, data } = validate(proposeIdentityLinkSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  const candidate = await env.ARENA_DB.prepare(
    `SELECT c.id, c.name, r.office FROM candidates c JOIN races r ON c.race_id = r.id WHERE c.id = ? AND c.is_active = 1`
  ).bind(data.candidate_id).first();
  if (!candidate) return errorResponse('Candidate not found', 404);
  if (candidate.office === 'Governor' || candidate.office === 'Mayor') {
    // A sitting legislator can run for governor, so this is allowed — but the reviewer should see why it is unusual.
    data.evidence_note = `[Candidate is running for ${candidate.office}; record is from prior legislative service] ${data.evidence_note || ''}`.trim();
  }

  const id = generateId('idl');
  try {
    await env.ARENA_DB.prepare(
      `INSERT INTO candidate_identity_links
         (id, candidate_id, identifier_type, identifier_value, official_name, match_method, match_confidence,
          evidence_url, evidence_note, proposed_by)
       VALUES (?, ?, 'bioguide', ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, data.candidate_id, data.identifier_value, data.official_name, data.match_method, data.match_confidence,
      data.evidence_url, data.evidence_note || null, request.user.id,
    ).run();
  } catch (error) {
    if (String(error?.message || error).includes('UNIQUE')) {
      return errorResponse('This candidate already has a proposed or confirmed identity link. Reject or revoke it first.', 409);
    }
    throw error;
  }

  await auditLogNow(env.ARENA_DB, {
    actorId: request.user.id,
    action: 'identity_link.propose',
    entityType: 'candidate_identity_link',
    entityId: id,
    afterState: {
      candidate_id: data.candidate_id, identifier_value: data.identifier_value, official_name: data.official_name,
      match_method: data.match_method, match_confidence: data.match_confidence, evidence_url: data.evidence_url,
    },
    ipAddress: getClientIP(request),
  });

  return successResponse({ id, status: 'proposed' });
});

// POST /api/voting-records/identity-links/:id/review — second person confirms or rejects
router.post('/identity-links/:id/review', async (request, env) => {
  const authError = await requireRole(...REVIEWERS)(request, env);
  if (authError) return authError;

  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid request body');
  const { valid, errors, data } = validate(reviewIdentityLinkSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  const link = await env.ARENA_DB.prepare(
    `SELECT id, candidate_id, identifier_value, status, proposed_by FROM candidate_identity_links WHERE id = ?`
  ).bind(request.params.id).first();
  if (!link) return errorResponse('Identity link not found', 404);
  if (link.status !== 'proposed') return errorResponse(`This link is already ${link.status}`, 409);
  if (link.proposed_by === request.user.id) {
    return errorResponse('A second reviewer must decide. You proposed this link.', 403);
  }

  const newStatus = data.decision === 'confirm' ? 'confirmed' : 'rejected';
  // Conditional update: two reviewers racing cannot both decide.
  const result = await env.ARENA_DB.prepare(
    `UPDATE candidate_identity_links
     SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), review_note = ?, updated_at = datetime('now')
     WHERE id = ? AND status = 'proposed' AND proposed_by != ?`
  ).bind(newStatus, request.user.id, data.note, link.id, request.user.id).run();
  if (!result.meta?.changes) return errorResponse('This link was already decided', 409);

  await auditLogNow(env.ARENA_DB, {
    actorId: request.user.id,
    action: `identity_link.${data.decision}`,
    entityType: 'candidate_identity_link',
    entityId: link.id,
    beforeState: { status: 'proposed' },
    afterState: { status: newStatus, candidate_id: link.candidate_id, identifier_value: link.identifier_value, note: data.note },
    ipAddress: getClientIP(request),
  });

  return successResponse({ id: link.id, status: newStatus });
});

// POST /api/voting-records/identity-links/:id/revoke — take a confirmed link down at once
router.post('/identity-links/:id/revoke', async (request, env) => {
  const authError = await requireRole(...REVIEWERS)(request, env);
  if (authError) return authError;

  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid request body');
  const { valid, errors, data } = validate(revokeIdentityLinkSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  const result = await env.ARENA_DB.prepare(
    `UPDATE candidate_identity_links
     SET status = 'revoked', reviewed_by = ?, reviewed_at = datetime('now'), review_note = ?, updated_at = datetime('now')
     WHERE id = ? AND status = 'confirmed'`
  ).bind(request.user.id, data.note, request.params.id).run();
  if (!result.meta?.changes) return errorResponse('No confirmed identity link with that id', 404);

  await auditLogNow(env.ARENA_DB, {
    actorId: request.user.id,
    action: 'identity_link.revoke',
    entityType: 'candidate_identity_link',
    entityId: request.params.id,
    beforeState: { status: 'confirmed' },
    afterState: { status: 'revoked', note: data.note },
    ipAddress: getClientIP(request),
  });

  return successResponse({ id: request.params.id, status: 'revoked' });
});

// POST /api/voting-records/import — admin loads one roll call from a cited official source
router.post('/import', async (request, env) => {
  const authError = await requireRole(...ADMINS)(request, env);
  if (authError) return authError;

  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid request body');
  const { valid, errors, data } = validate(importRollCallSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  // Refuse the whole import if any position is unrecognized: a hand-entered
  // record with a guessed vote is worse than no record.
  const unknown = data.votes.filter(v => !normalizeVotePosition(v.position)).map(v => `${v.bioguide_id}: "${v.position}"`);
  if (unknown.length > 0) {
    return errorResponse(`Unrecognized vote position (use Yea, Nay, Present or Not Voting): ${unknown.slice(0, 5).join(', ')}`);
  }
  const ids = data.votes.map(v => v.bioguide_id);
  if (new Set(ids).size !== ids.length) return errorResponse('A member appears more than once in this roll call');

  const stored = await upsertRollCall(env.ARENA_DB, data.roll_call, data.votes, { importedBy: request.user.id });

  await auditLogNow(env.ARENA_DB, {
    actorId: request.user.id,
    action: 'roll_call.import',
    entityType: 'roll_call',
    entityId: stored.roll_call_id,
    afterState: {
      chamber: data.roll_call.chamber, congress: data.roll_call.congress, session: data.roll_call.session,
      roll_number: data.roll_call.roll_number, source_url: data.roll_call.source_url, votes_written: stored.votes_written,
    },
    ipAddress: getClientIP(request),
  });

  return successResponse(stored);
});

// POST /api/voting-records/sync — admin pulls recent House roll calls from Congress.gov
router.post('/sync', async (request, env) => {
  const authError = await requireRole(...ADMINS)(request, env);
  if (authError) return authError;
  if (!env.CONGRESS_API_KEY) {
    return errorResponse('Congress.gov sync is not configured. Set the CONGRESS_API_KEY secret, or use the manual import.', 503);
  }

  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid request body');
  const { valid, errors, data } = validate(syncHouseVotesSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  let outcome;
  try {
    outcome = await syncHouseVotes(env, data);
  } catch (error) {
    console.error('Congress.gov sync failed:', error?.message || error);
    return errorResponse('Congress.gov could not be reached. Nothing was changed.', 502);
  }

  await auditLogNow(env.ARENA_DB, {
    actorId: request.user.id,
    action: 'roll_call.sync',
    entityType: 'roll_call_sync',
    entityId: `house-${data.congress}-${data.session}`,
    afterState: { roll_calls: outcome.roll_calls, votes_written: outcome.votes_written, failures: outcome.failures.length },
    ipAddress: getClientIP(request),
  });

  return successResponse(outcome);
});

router.all('*', () => errorResponse('Voting records endpoint not found', 404));

export default router;
