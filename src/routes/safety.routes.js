/**
 * Arena — Safety Case Routes (moderator/admin only)
 *
 * Backend tooling for flagging and following threats: harassment,
 * impersonation, coordinated abuse, election-integrity issues, or anything
 * that needs a durable trail. Cases carry an append-only event log, and every
 * read of a subject's cross-platform activity is itself audit-logged, so use
 * of this surveillance-adjacent capability is accountable.
 */

import { Router } from 'itty-router';
import { generateId } from '../db.js';
import { auditLog, auditLogNow } from '../audit.js';
import { requireRole, errorResponse, successResponse, parseBody, parsePagination, getClientIP } from '../middleware.js';

const router = Router({ base: '/api/safety' });

const SUBJECT_TYPES = ['user', 'candidate', 'challenge', 'ad', 'rebuttal', 'question', 'recite', 'statement', 'other'];
const CATEGORIES = ['threat', 'harassment', 'impersonation', 'coordinated_abuse', 'election_integrity', 'legal', 'other'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const STATUSES = ['open', 'watching', 'escalated', 'resolved'];

const guard = requireRole('moderator', 'admin', 'super_admin');

// POST /api/safety/cases — open a case on a subject
router.post('/cases', async (request, env, ctx) => {
  const authError = await guard(request, env);
  if (authError) return authError;

  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid request body');
  const { subject_type, subject_id, title } = body;
  if (!SUBJECT_TYPES.includes(subject_type)) return errorResponse(`subject_type must be one of: ${SUBJECT_TYPES.join(', ')}`);
  if (!subject_id || typeof subject_id !== 'string' || subject_id.length > 120) return errorResponse('subject_id required (max 120 chars)');
  if (!title || typeof title !== 'string' || title.trim().length < 3 || title.length > 200) return errorResponse('title required (3-200 chars)');
  const category = CATEGORIES.includes(body.category) ? body.category : 'other';
  const severity = SEVERITIES.includes(body.severity) ? body.severity : 'medium';
  const summary = typeof body.summary === 'string' ? body.summary.slice(0, 3000) : null;

  const caseId = generateId('safe');
  await env.ARENA_DB.batch([
    env.ARENA_DB.prepare(
      `INSERT INTO safety_cases (id, subject_type, subject_id, category, severity, title, summary, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(caseId, subject_type, subject_id, category, severity, title.trim(), summary, request.user.id),
    env.ARENA_DB.prepare(
      `INSERT INTO safety_case_events (id, case_id, actor_id, event_type, after_value, note)
       VALUES (?, ?, ?, 'note', 'open', 'Case opened')`
    ).bind(generateId('sev'), caseId, request.user.id),
  ]);

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: 'safety_case.open',
    entityType: 'safety_case',
    entityId: caseId,
    afterState: { subject_type, subject_id, category, severity, title: title.trim() },
    ipAddress: getClientIP(request),
  });

  return successResponse({ id: caseId, subject_type, subject_id, category, severity, status: 'open' });
});

// GET /api/safety/cases — list/filter cases
router.get('/cases', async (request, env) => {
  const authError = await guard(request, env);
  if (authError) return authError;

  const url = new URL(request.url);
  const { limit, offset } = parsePagination(url);
  const status = url.searchParams.get('status');
  const severity = url.searchParams.get('severity');
  const subjectType = url.searchParams.get('subject_type');
  const subjectId = url.searchParams.get('subject_id');

  let sql = `SELECT sc.*, u.display_name as created_by_name,
      (SELECT COUNT(*) FROM safety_case_events e WHERE e.case_id = sc.id) as event_count
    FROM safety_cases sc JOIN users u ON u.id = sc.created_by WHERE 1=1`;
  const binds = [];
  if (status && STATUSES.includes(status)) { sql += ` AND sc.status = ?`; binds.push(status); }
  if (severity && SEVERITIES.includes(severity)) { sql += ` AND sc.severity = ?`; binds.push(severity); }
  if (subjectType && SUBJECT_TYPES.includes(subjectType)) { sql += ` AND sc.subject_type = ?`; binds.push(subjectType); }
  if (subjectId) { sql += ` AND sc.subject_id = ?`; binds.push(subjectId); }
  sql += ` ORDER BY CASE sc.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, sc.updated_at DESC LIMIT ? OFFSET ?`;
  binds.push(limit, offset);

  const result = await env.ARENA_DB.prepare(sql).bind(...binds).all();
  return successResponse({ cases: result.results || [] });
});

// GET /api/safety/cases/:id — case detail with full event trail
router.get('/cases/:id', async (request, env) => {
  const authError = await guard(request, env);
  if (authError) return authError;

  const { id } = request.params;
  const safetyCase = await env.ARENA_DB.prepare(`SELECT * FROM safety_cases WHERE id = ?`).bind(id).first();
  if (!safetyCase) return errorResponse('Case not found', 404);

  const events = await env.ARENA_DB.prepare(
    `SELECT e.*, u.display_name as actor_name FROM safety_case_events e
     JOIN users u ON u.id = e.actor_id WHERE e.case_id = ? ORDER BY e.created_at ASC LIMIT 500`
  ).bind(id).all();

  return successResponse({ case: safetyCase, events: events.results || [] });
});

// POST /api/safety/cases/:id/events — append a note / status / severity change / evidence
router.post('/cases/:id/events', async (request, env, ctx) => {
  const authError = await guard(request, env);
  if (authError) return authError;

  const { id } = request.params;
  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid request body');

  const safetyCase = await env.ARENA_DB.prepare(`SELECT * FROM safety_cases WHERE id = ?`).bind(id).first();
  if (!safetyCase) return errorResponse('Case not found', 404);

  const note = typeof body.note === 'string' ? body.note.slice(0, 3000) : null;
  const evidenceUrl = typeof body.evidence_url === 'string' && /^https?:\/\//i.test(body.evidence_url)
    ? body.evidence_url.slice(0, 1000) : null;
  const statements = [];
  let eventType = 'note';
  let beforeValue = null;
  let afterValue = null;

  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return errorResponse(`status must be one of: ${STATUSES.join(', ')}`);
    eventType = 'status_change';
    beforeValue = safetyCase.status;
    afterValue = body.status;
    statements.push(env.ARENA_DB.prepare(
      `UPDATE safety_cases SET status = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(body.status, id));
  } else if (body.severity !== undefined) {
    if (!SEVERITIES.includes(body.severity)) return errorResponse(`severity must be one of: ${SEVERITIES.join(', ')}`);
    eventType = 'severity_change';
    beforeValue = safetyCase.severity;
    afterValue = body.severity;
    statements.push(env.ARENA_DB.prepare(
      `UPDATE safety_cases SET severity = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(body.severity, id));
  } else if (evidenceUrl) {
    eventType = 'evidence';
  } else if (!note) {
    return errorResponse('Provide a note, status, severity, or evidence_url');
  }

  const eventId = generateId('sev');
  statements.push(env.ARENA_DB.prepare(
    `INSERT INTO safety_case_events (id, case_id, actor_id, event_type, before_value, after_value, note, evidence_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(eventId, id, request.user.id, eventType, beforeValue, afterValue, note, evidenceUrl));
  if (statements.length === 1) {
    // note/evidence only — still bump the case's activity timestamp
    statements.push(env.ARENA_DB.prepare(
      `UPDATE safety_cases SET updated_at = datetime('now') WHERE id = ?`
    ).bind(id));
  }
  await env.ARENA_DB.batch(statements);

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: `safety_case.${eventType}`,
    entityType: 'safety_case',
    entityId: id,
    beforeState: beforeValue ? { value: beforeValue } : null,
    afterState: { value: afterValue, note_present: !!note },
    ipAddress: getClientIP(request),
  });

  return successResponse({ id: eventId, case_id: id, event_type: eventType });
});

// GET /api/safety/subjects/:type/:id/activity — cross-platform activity for a
// flagged subject. Access is itself audit-logged (accountable surveillance).
router.get('/subjects/:type/:id/activity', async (request, env) => {
  const authError = await guard(request, env);
  if (authError) return authError;

  const { type, id } = request.params;
  if (!['user', 'candidate'].includes(type)) {
    return errorResponse('activity tracking supports subject types: user, candidate');
  }

  await auditLogNow(env.ARENA_DB, {
    actorId: request.user.id,
    action: 'safety.activity_lookup',
    entityType: type,
    entityId: id,
    ipAddress: getClientIP(request),
  });

  if (type === 'candidate') {
    const [challengesIssued, challengesReceived, ads, recentChallenges] = await Promise.all([
      env.ARENA_DB.prepare(`SELECT COUNT(*) as total FROM challenges WHERE challenger_candidate_id = ?`).bind(id).first(),
      env.ARENA_DB.prepare(`SELECT COUNT(*) as total FROM challenges WHERE target_candidate_id = ?`).bind(id).first(),
      env.ARENA_DB.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected FROM ad_flights WHERE candidate_id = ?`).bind(id).first(),
      env.ARENA_DB.prepare(
        `SELECT id, challenge_type, status, claim_text, challenge_text, created_at FROM challenges
         WHERE challenger_candidate_id = ? OR target_candidate_id = ? ORDER BY created_at DESC LIMIT 20`
      ).bind(id, id).all(),
    ]);
    return successResponse({
      subject: { type, id },
      challenges_issued: challengesIssued?.total || 0,
      challenges_received: challengesReceived?.total || 0,
      ads: ads || {},
      recent_challenges: recentChallenges.results || [],
    });
  }

  const [account, staffLinks, questions, recites, corrections, recentSessions, recentEvents] = await Promise.all([
    env.ARENA_DB.prepare(
      `SELECT id, username, display_name, role, verification_status, email_verified, is_active, created_at, last_login FROM users WHERE id = ?`
    ).bind(id).first(),
    env.ARENA_DB.prepare(
      `SELECT csl.candidate_id, csl.role, c.name as candidate_name FROM candidate_staff_links csl JOIN candidates c ON c.id = csl.candidate_id WHERE csl.user_id = ? AND csl.is_active = 1`
    ).bind(id).all(),
    env.ARENA_DB.prepare(`SELECT COUNT(*) as total FROM questions WHERE user_id = ?`).bind(id).first(),
    env.ARENA_DB.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected FROM recites WHERE user_id = ?`).bind(id).first(),
    env.ARENA_DB.prepare(`SELECT COUNT(*) as total FROM correction_requests WHERE requester_id = ?`).bind(id).first(),
    env.ARENA_DB.prepare(
      `SELECT ip_address, user_agent, created_at, is_active FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`
    ).bind(id).all(),
    env.ARENA_DB.prepare(
      `SELECT event_type, race_id, content_type, content_id, created_at FROM analytics_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 25`
    ).bind(id).all(),
  ]);

  if (!account) return errorResponse('User not found', 404);

  return successResponse({
    subject: { type, id },
    account,
    staff_links: staffLinks.results || [],
    question_count: questions?.total || 0,
    recites: recites || {},
    correction_requests: corrections?.total || 0,
    recent_sessions: recentSessions.results || [],
    recent_events: recentEvents.results || [],
  });
});

router.all('*', () => errorResponse('Safety endpoint not found', 404));

export default router;
