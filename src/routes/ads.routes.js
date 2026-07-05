/**
 * Arena — Ad Flight Routes
 * CRUD for ads, review pipeline, rebuttal eligibility
 */

import { Router } from 'itty-router';
import { generateId } from '../db.js';
import { auditLog } from '../audit.js';
import { requireAuth, requireRole, errorResponse, successResponse, parseBody, parsePagination, getClientIP } from '../middleware.js';
import { authenticate } from '../auth.js';
import { validate, createAdSchema, updateAdSchema, reviewAdSchema, createRebuttalSchema, createExternalAdResponseSchema } from '../validation.js';

const router = Router({ base: '/api/ads' });

function inferAdMediaType(url) {
  if (!url) return 'text';
  if (/(youtube\.com|youtu\.be|vimeo\.com)/i.test(url)) return 'video';
  if (/\.(mp4|m4v|mov|webm|ogv|ogg|3gp|3g2)(\?|#|$)/i.test(url)) return 'video';
  if (/\.(jpg|jpeg|png|gif|webp|avif|heic|heif)(\?|#|$)/i.test(url)) return 'image';
  return 'video';
}

// GET /api/ads/races/:raceId — Public, with paired rebuttals
router.get('/races/:raceId', async (request, env) => {
  const { raceId } = request.params;
  const url = new URL(request.url);
  const { limit, offset } = parsePagination(url);

  const ads = await env.ARENA_DB.prepare(
    `SELECT af.*, c.name as candidate_name, c.party as candidate_party
     FROM ad_flights af
     JOIN candidates c ON af.candidate_id = c.id
     WHERE af.race_id = ? AND af.status IN ('approved','active')
     ORDER BY af.created_at DESC LIMIT ? OFFSET ?`
  ).bind(raceId, limit, offset).all();

  // Fetch paired rebuttals for each ad
  const adIds = (ads.results || []).map(a => a.id);
  let rebuttals = [];
  if (adIds.length > 0) {
    const placeholders = adIds.map(() => '?').join(',');
    const rebuttalResult = await env.ARENA_DB.prepare(
      `SELECT ra.*, c.name as candidate_name, c.party as candidate_party
       FROM rebuttal_ads ra
       JOIN candidates c ON ra.candidate_id = c.id
       WHERE ra.parent_ad_id IN (${placeholders}) AND ra.status IN ('approved','active')
       ORDER BY ra.priority_score DESC, ra.created_at ASC`
    ).bind(...adIds).all();
    rebuttals = rebuttalResult.results || [];
  }

  // Group rebuttals by parent ad for the "paired unit" API response
  const adPairs = (ads.results || []).map(ad => ({
    ...ad,
    rebuttals: rebuttals.filter(r => r.parent_ad_id === ad.id),
    rebuttal_window_active: ad.rebuttal_window_expires && new Date(ad.rebuttal_window_expires) > new Date(),
  }));

  return successResponse({ ads: adPairs });
});

// GET /api/ads/:id — Public single ad (drafts/rejected visible only to staff/admin)
router.get('/:id', async (request, env) => {
  const { id } = request.params;
  const ad = await env.ARENA_DB.prepare(
    `SELECT af.*, c.name as candidate_name, c.party as candidate_party
     FROM ad_flights af JOIN candidates c ON af.candidate_id = c.id WHERE af.id = ?`
  ).bind(id).first();

  if (!ad) return errorResponse('Ad not found', 404);

  // Unpublished ads are only visible to the owning candidate's staff or admins
  if (!['approved', 'active', 'completed'].includes(ad.status)) {
    const user = await authenticate(request, env);
    const isAdmin = user && ['admin', 'super_admin', 'moderator'].includes(user.role);
    let isStaff = false;
    if (user && !isAdmin) {
      const link = await env.ARENA_DB.prepare(
        `SELECT id FROM candidate_staff_links WHERE user_id = ? AND candidate_id = ? AND is_active = 1`
      ).bind(user.id, ad.candidate_id).first();
      isStaff = !!link;
    }
    if (!isAdmin && !isStaff) return errorResponse('Ad not found', 404);
  }

  const rebuttals = await env.ARENA_DB.prepare(
    `SELECT ra.*, c.name as candidate_name, c.party as candidate_party
     FROM rebuttal_ads ra JOIN candidates c ON ra.candidate_id = c.id
     WHERE ra.parent_ad_id = ? AND ra.status IN ('approved','active')
     ORDER BY ra.priority_score DESC`
  ).bind(id).all();

  return successResponse({ ...ad, rebuttals: rebuttals.results || [] });
});

// POST /api/ads — Create ad draft (candidate staff)
router.post('/', async (request, env, ctx) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid request body');

  const { valid, errors, data } = validate(createAdSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  // Campaign speech requires an explicit staff link; platform admin is not campaign authority.
  const link = await env.ARENA_DB.prepare(
    `SELECT id FROM candidate_staff_links WHERE user_id = ? AND candidate_id = ? AND is_active = 1`
  ).bind(request.user.id, data.candidate_id).first();
  if (!link) return errorResponse('Not authorized for this candidate', 403);

  // Verify candidate is in the specified race
  const candidate = await env.ARENA_DB.prepare(
    `SELECT id, race_id FROM candidates WHERE id = ? AND race_id = ? AND is_active = 1`
  ).bind(data.candidate_id, data.race_id).first();
  if (!candidate) return errorResponse('Candidate not found in this race', 404);

  const adId = generateId('ad');
  await env.ARENA_DB.prepare(
    `INSERT INTO ad_flights (id, race_id, candidate_id, created_by, title, ad_content_text, disclaimer_text, media_url, media_type, budget_cents, start_date, end_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    adId, data.race_id, data.candidate_id, request.user.id,
    data.title, data.ad_content_text, data.disclaimer_text,
    data.media_url || null, data.media_type, data.budget_cents,
    data.start_date || null, data.end_date || null,
  ).run();

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: 'ad.create',
    entityType: 'ad_flight',
    entityId: adId,
    afterState: data,
    ipAddress: getClientIP(request),
  });

  return successResponse({ id: adId, status: 'draft' });
});

// POST /api/ads/:id/submit — Submit ad for review
router.post('/:id/submit', async (request, env, ctx) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const { id } = request.params;
  const ad = await env.ARENA_DB.prepare(`SELECT * FROM ad_flights WHERE id = ?`).bind(id).first();
  if (!ad) return errorResponse('Ad not found', 404);
  if (!['draft', 'rejected'].includes(ad.status)) return errorResponse('Ad can only be submitted from draft or rejected status');

  const link = await env.ARENA_DB.prepare(
    `SELECT id FROM candidate_staff_links WHERE user_id = ? AND candidate_id = ? AND is_active = 1`
  ).bind(request.user.id, ad.candidate_id).first();
  if (!link) return errorResponse('Not authorized', 403);

  if (!ad.disclaimer_text) return errorResponse('Disclaimer text is required before submission');

  await env.ARENA_DB.prepare(
    `UPDATE ad_flights SET status = 'submitted', updated_at = datetime('now') WHERE id = ?`
  ).bind(id).run();

  // Auto-add to moderation queue
  const modId = generateId('mod');
  await env.ARENA_DB.prepare(
    `INSERT INTO moderation_queue (id, content_type, content_id, reason, reported_by, status) VALUES (?, 'ad_flight', ?, 'ad_submission', ?, 'flagged')`
  ).bind(modId, id, request.user.id).run();

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: 'ad.submit',
    entityType: 'ad_flight',
    entityId: id,
    beforeState: { status: ad.status },
    afterState: { status: 'submitted' },
    ipAddress: getClientIP(request),
  });

  return successResponse({ id, status: 'submitted' });
});

// POST /api/ads/:id/review — Moderator approves/rejects
router.post('/:id/review', async (request, env, ctx) => {
  const authError = await requireRole('moderator', 'admin', 'super_admin')(request, env);
  if (authError) return authError;

  const { id } = request.params;
  const body = await parseBody(request);
  const { valid, errors, data } = validate(reviewAdSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  const ad = await env.ARENA_DB.prepare(`SELECT * FROM ad_flights WHERE id = ?`).bind(id).first();
  if (!ad) return errorResponse('Ad not found', 404);
  if (ad.status !== 'submitted') return errorResponse('Ad is not pending review');

  const rebuttalWindowHours = parseInt(env.REBUTTAL_WINDOW_HOURS || '48');
  const rebuttalExpires = new Date(Date.now() + rebuttalWindowHours * 60 * 60 * 1000).toISOString();

  if (data.action === 'approve') {
    await env.ARENA_DB.prepare(
      `UPDATE ad_flights SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now'), approved_at = datetime('now'), rebuttal_window_expires = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(request.user.id, rebuttalExpires, id).run();
  } else {
    await env.ARENA_DB.prepare(
      `UPDATE ad_flights SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now'), rejection_reason = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(request.user.id, data.rejection_reason || null, id).run();
  }

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: `ad.${data.action}`,
    entityType: 'ad_flight',
    entityId: id,
    beforeState: { status: ad.status },
    afterState: { status: data.action === 'approve' ? 'approved' : 'rejected' },
    ipAddress: getClientIP(request),
  });

  return successResponse({ id, status: data.action === 'approve' ? 'approved' : 'rejected' });
});

// POST /api/ads/:id/activate — Manually activate approved ad
router.post('/:id/activate', async (request, env, ctx) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const { id } = request.params;
  const ad = await env.ARENA_DB.prepare(`SELECT * FROM ad_flights WHERE id = ?`).bind(id).first();
  if (!ad) return errorResponse('Ad not found', 404);
  if (ad.status !== 'approved') return errorResponse('Ad must be approved before activation');

  const link = await env.ARENA_DB.prepare(
    `SELECT id FROM candidate_staff_links WHERE user_id = ? AND candidate_id = ? AND is_active = 1`
  ).bind(request.user.id, ad.candidate_id).first();
  if (!link) return errorResponse('Not authorized for this candidate', 403);

  await env.ARENA_DB.prepare(
    `UPDATE ad_flights SET status = 'active', activated_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
  ).bind(id).run();

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: 'ad.activate',
    entityType: 'ad_flight',
    entityId: id,
    ipAddress: getClientIP(request),
  });

  return successResponse({ id, status: 'active' });
});

// GET /api/ads/candidates/:candidateId — Staff view of their own ads
router.get('/candidates/:candidateId', async (request, env) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const { candidateId } = request.params;

  const link = await env.ARENA_DB.prepare(
    `SELECT id FROM candidate_staff_links WHERE user_id = ? AND candidate_id = ? AND is_active = 1`
  ).bind(request.user.id, candidateId).first();
  if (!link) return errorResponse('Not authorized', 403);

  const result = await env.ARENA_DB.prepare(
    `SELECT * FROM ad_flights WHERE candidate_id = ? ORDER BY created_at DESC`
  ).bind(candidateId).all();

  return successResponse({ ads: result.results || [] });
});

// ===== REBUTTAL ROUTES =====

// GET /api/ads/:adId/rebuttal-eligibility — Check if candidate can rebut
router.get('/:adId/rebuttal-eligibility', async (request, env) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const { adId } = request.params;
  const url = new URL(request.url);
  const candidateId = url.searchParams.get('candidate_id');

  if (!candidateId) return errorResponse('candidate_id query parameter required');

  const ad = await env.ARENA_DB.prepare(`SELECT * FROM ad_flights WHERE id = ?`).bind(adId).first();
  if (!ad) return errorResponse('Ad not found', 404);

  // Check eligibility
  const issues = [];

  if (!['approved', 'active'].includes(ad.status)) issues.push('Ad is not approved/active');
  if (ad.rebuttal_window_expires && new Date(ad.rebuttal_window_expires) <= new Date()) issues.push('Rebuttal window has expired');
  if (ad.candidate_id === candidateId) issues.push('Cannot rebut your own ad');

  // Same race check
  const candidate = await env.ARENA_DB.prepare(
    `SELECT id, race_id, verification_status FROM candidates WHERE id = ? AND is_active = 1`
  ).bind(candidateId).first();

  if (!candidate) { issues.push('Candidate not found'); }
  else {
    if (candidate.race_id !== ad.race_id) issues.push('Candidate is not in the same race');
    if (candidate.verification_status !== 'verified') issues.push('Candidate is not verified');
  }

  // Staff link check
  const link = await env.ARENA_DB.prepare(
    `SELECT id FROM candidate_staff_links WHERE user_id = ? AND candidate_id = ? AND is_active = 1`
  ).bind(request.user.id, candidateId).first();
  if (!link) issues.push('You are not staff for this candidate');

  // Existing rebuttal check
  const existingRebuttal = await env.ARENA_DB.prepare(
    `SELECT id FROM rebuttal_ads WHERE parent_ad_id = ? AND candidate_id = ?`
  ).bind(adId, candidateId).first();
  if (existingRebuttal) issues.push('Candidate already has a rebuttal on this ad');

  // Max rebuttals check
  const rebuttalCount = await env.ARENA_DB.prepare(
    `SELECT COUNT(*) as count FROM rebuttal_ads WHERE parent_ad_id = ?`
  ).bind(adId).first();
  if (rebuttalCount.count >= (ad.max_rebuttals || 3)) issues.push('Maximum rebuttals reached for this ad');

  return successResponse({
    eligible: issues.length === 0,
    issues,
    slots_remaining: Math.max(0, (ad.max_rebuttals || 3) - rebuttalCount.count),
    window_expires: ad.rebuttal_window_expires,
  });
});

// POST /api/ads/rebuttals — Create rebuttal (staff of eligible candidate)
router.post('/rebuttals', async (request, env, ctx) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid request body');

  const { valid, errors, data } = validate(createRebuttalSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  // Full eligibility check via D1.batch() for atomicity
  const ad = await env.ARENA_DB.prepare(`SELECT * FROM ad_flights WHERE id = ?`).bind(data.parent_ad_id).first();
  if (!ad) return errorResponse('Ad not found', 404);

  if (!['approved', 'active'].includes(ad.status)) return errorResponse('Ad is not active');
  if (ad.rebuttal_window_expires && new Date(ad.rebuttal_window_expires) <= new Date()) return errorResponse('Rebuttal window has expired');
  if (ad.candidate_id === data.candidate_id) return errorResponse('Cannot rebut your own ad');

  const candidate = await env.ARENA_DB.prepare(
    `SELECT id, race_id, verification_status FROM candidates WHERE id = ? AND is_active = 1`
  ).bind(data.candidate_id).first();
  if (!candidate || candidate.race_id !== ad.race_id) return errorResponse('Candidate must be in the same race');
  if (candidate.verification_status !== 'verified') return errorResponse('Candidate must be verified');

  const rebuttalStaffLink = await env.ARENA_DB.prepare(
    `SELECT id FROM candidate_staff_links WHERE user_id = ? AND candidate_id = ? AND is_active = 1`
  ).bind(request.user.id, data.candidate_id).first();
  if (!rebuttalStaffLink) return errorResponse('Not authorized for this candidate', 403);

  const existingRebuttal = await env.ARENA_DB.prepare(
    `SELECT id FROM rebuttal_ads WHERE parent_ad_id = ? AND candidate_id = ?`
  ).bind(data.parent_ad_id, data.candidate_id).first();
  if (existingRebuttal) return errorResponse('Already have a rebuttal on this ad', 409);

  const rebuttalCount = await env.ARENA_DB.prepare(
    `SELECT COUNT(*) as count FROM rebuttal_ads WHERE parent_ad_id = ?`
  ).bind(data.parent_ad_id).first();
  if (rebuttalCount.count >= (ad.max_rebuttals || 3)) return errorResponse('Max rebuttals reached');

  const rebuttalId = generateId('reb');
  const rebuttalStatus = 'draft';
  await env.ARENA_DB.prepare(
    `INSERT INTO rebuttal_ads (id, parent_ad_id, race_id, candidate_id, created_by, response_text, disclaimer_text, media_url, status, slot_claimed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).bind(rebuttalId, data.parent_ad_id, ad.race_id, data.candidate_id, request.user.id, data.response_text, data.disclaimer_text, data.media_url || null, rebuttalStatus).run();

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: 'rebuttal.create',
    entityType: 'rebuttal_ad',
    entityId: rebuttalId,
    afterState: { parent_ad_id: data.parent_ad_id, candidate_id: data.candidate_id },
    ipAddress: getClientIP(request),
  });

  return successResponse({ id: rebuttalId, status: rebuttalStatus });
});

// POST /api/ads/external-response — Pair an outside/TV ad with a candidate response.
// This is the fairness path for attacks that happen off-platform: the responder
// can post the original ad as context and place their answer next to it.
router.post('/external-response', async (request, env, ctx) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid request body');

  const { valid, errors, data } = validate(createExternalAdResponseSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  if (data.source_candidate_id === data.responder_candidate_id) {
    return errorResponse('Cannot respond to your own outside ad');
  }

  const sourceCandidate = await env.ARENA_DB.prepare(
    `SELECT id, race_id, name FROM candidates WHERE id = ? AND race_id = ? AND is_active = 1`
  ).bind(data.source_candidate_id, data.race_id).first();
  if (!sourceCandidate) return errorResponse('Source candidate not found in this race', 404);

  const responderCandidate = await env.ARENA_DB.prepare(
    `SELECT id, race_id, name, verification_status FROM candidates WHERE id = ? AND race_id = ? AND is_active = 1`
  ).bind(data.responder_candidate_id, data.race_id).first();
  if (!responderCandidate) return errorResponse('Responder candidate not found in this race', 404);

  if (responderCandidate.verification_status !== 'verified') {
    return errorResponse('Responder candidate must be verified');
  }

  const responderStaffLink = await env.ARENA_DB.prepare(
    `SELECT id FROM candidate_staff_links WHERE user_id = ? AND candidate_id = ? AND is_active = 1`
  ).bind(request.user.id, data.responder_candidate_id).first();
  if (!responderStaffLink) return errorResponse('Not authorized for this candidate', 403);

  const adId = generateId('ad');
  const rebuttalId = generateId('reb');
  const sourceDescription = data.source_description || `Outside ad being answered by ${responderCandidate.name}.`;
  const sourceDisclaimer = data.source_disclaimer_text || 'Outside ad posted for response context';

  await env.ARENA_DB.batch([
    env.ARENA_DB.prepare(
      `INSERT INTO ad_flights
       (id, race_id, candidate_id, created_by, title, media_url, media_type, ad_content_text, disclaimer_text,
        source_type, source_url, source_label, posted_for_rebuttal_by, status, approved_at, activated_at, rebuttal_window_expires, max_rebuttals)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'external', ?, ?, ?, 'active', datetime('now'), datetime('now'), NULL, 1)`
    ).bind(
      adId,
      data.race_id,
      data.source_candidate_id,
      request.user.id,
      data.source_title,
      data.source_media_url,
      inferAdMediaType(data.source_media_url),
      sourceDescription,
      sourceDisclaimer,
      data.source_media_url,
      'Outside ad being answered',
      data.responder_candidate_id,
    ),
    env.ARENA_DB.prepare(
      `INSERT INTO rebuttal_ads
       (id, parent_ad_id, race_id, candidate_id, created_by, response_text, disclaimer_text, media_url, status, slot_claimed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))`
    ).bind(
      rebuttalId,
      adId,
      data.race_id,
      data.responder_candidate_id,
      request.user.id,
      data.response_text,
      data.disclaimer_text,
      data.response_media_url || null,
    ),
  ]);

  auditLog(env.ARENA_DB, ctx, {
    actorId: request.user.id,
    action: 'external_ad_response.create',
    entityType: 'ad_flight',
    entityId: adId,
    afterState: {
      source_candidate_id: data.source_candidate_id,
      responder_candidate_id: data.responder_candidate_id,
      rebuttal_id: rebuttalId,
    },
    ipAddress: getClientIP(request),
  });

  return successResponse({ ad_id: adId, rebuttal_id: rebuttalId, status: 'active' });
});

export default router;
