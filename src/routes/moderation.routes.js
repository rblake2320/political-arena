/**
 * Arena — Public report-abuse routes
 *
 * Any signed-in user can flag content (defamation, threats, impersonation,
 * AI-media without disclosure, spam …). Reports land in the existing
 * moderation_queue with reason 'user_report' and surface in the moderation
 * UI's Reports tab. Rate-limited; every resolution is audit-logged.
 */

import { Router } from 'itty-router';
import { generateId } from '../db.js';
import { auditLog } from '../audit.js';
import { requireAuth, requireRole, errorResponse, successResponse, parseBody, parsePagination, getClientIP } from '../middleware.js';
import { checkRateLimit } from '../ratelimit.js';

const router = Router({ base: '/api/moderation' });

const REPORTABLE = {
  ad: 'ad_flights',
  rebuttal: 'rebuttal_ads',
  challenge: 'challenges',
  challenge_response: 'challenge_responses',
  question: 'questions',
  recite: 'recites',
  candidate: 'candidates',
};
const CATEGORIES = ['defamation', 'threat_or_harassment', 'impersonation', 'undisclosed_ai_media', 'election_misinformation', 'copyright', 'spam', 'other'];

// POST /api/moderation/reports — flag content for review
router.post('/reports', async (request, env, ctx) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const rl = await checkRateLimit(env.ARENA_DB, `report:${request.user.id}`, 10, 60 * 60);
  if (rl.limited) return errorResponse('Too many reports. Please try again later.', 429);

  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid request body');
  const { content_type, content_id, category, details } = body;
  if (!REPORTABLE[content_type]) return errorResponse(`content_type must be one of: ${Object.keys(REPORTABLE).join(', ')}`);
  if (!content_id || typeof content_id !== 'string' || content_id.length > 120) return errorResponse('content_id required');
  const cat = CATEGORIES.includes(category) ? category : 'other';
  const note = typeof details === 'string' ? details.slice(0, 2000) : '';

  const target = await env.ARENA_DB.prepare(
    `SELECT id FROM ${REPORTABLE[content_type]} WHERE id = ?`
  ).bind(content_id).first();
  if (!target) return errorResponse('Reported content not found', 404);

  const reportId = generateId('rep');
  await env.ARENA_DB.prepare(
    `INSERT INTO moderation_queue (id, content_type, content_id, reason, reported_by, status, notes, priority)
     VALUES (?, ?, ?, 'user_report', ?, 'flagged', ?, ?)`
  ).bind(
    reportId,
    content_type,
    content_id,
    request.user.id,
    `[${cat}] ${note}`.trim(),
    cat === 'threat_or_harassment' || cat === 'election_misinformation' ? 2 : 1,
  ).run();

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: 'content.report',
    entityType: content_type,
    entityId: content_id,
    afterState: { category: cat, report_id: reportId },
    ipAddress: getClientIP(request),
  });

  return successResponse({ id: reportId, message: 'Report filed. A moderator will review it; actions are recorded on the audit trail.' });
});

// GET /api/moderation/reports — open user reports (moderator/admin)
router.get('/reports', async (request, env) => {
  const authError = await requireRole('moderator', 'admin', 'super_admin')(request, env);
  if (authError) return authError;

  const url = new URL(request.url);
  const { limit, offset } = parsePagination(url);
  const result = await env.ARENA_DB.prepare(
    `SELECT mq.*, u.display_name as reporter_name
     FROM moderation_queue mq
     LEFT JOIN users u ON u.id = mq.reported_by
     WHERE mq.reason = 'user_report' AND mq.status IN ('flagged', 'under_review')
     ORDER BY mq.priority DESC, mq.created_at ASC
     LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();

  return successResponse({ reports: result.results || [] });
});

// PUT /api/moderation/reports/:id/resolve — close a report (moderator/admin)
router.put('/reports/:id/resolve', async (request, env, ctx) => {
  const authError = await requireRole('moderator', 'admin', 'super_admin')(request, env);
  if (authError) return authError;

  const { id } = request.params;
  const body = await parseBody(request);
  const outcome = body?.outcome === 'upheld' ? 'resolved_upheld' : 'resolved_overturned';
  const notes = typeof body?.resolution_notes === 'string' ? body.resolution_notes.slice(0, 2000) : null;

  const report = await env.ARENA_DB.prepare(
    `SELECT * FROM moderation_queue WHERE id = ? AND reason = 'user_report'`
  ).bind(id).first();
  if (!report) return errorResponse('Report not found', 404);

  await env.ARENA_DB.prepare(
    `UPDATE moderation_queue SET status = ?, resolved_by = ?, resolution_notes = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(outcome, request.user.id, notes, id).run();

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: 'report.resolve',
    entityType: report.content_type,
    entityId: report.content_id,
    beforeState: { status: report.status },
    afterState: { status: outcome, notes_present: !!notes },
    ipAddress: getClientIP(request),
  });

  return successResponse({ id, status: outcome });
});

router.all('*', () => errorResponse('Moderation endpoint not found', 404));

export default router;
