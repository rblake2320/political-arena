/**
 * Arena — Analytics Routes
 * Event ingestion + dashboards + premium candidate insights
 * Behind-the-scenes data engine — not all public-facing
 */

import { Router } from 'itty-router';
import { generateId } from '../db.js';
import { requireAuth, requireRole, errorResponse, successResponse, parseBody, parsePagination, getClientIP } from '../middleware.js';
import { authenticate, hashIP, verifyJWT } from '../auth.js';
import { checkRateLimit } from '../ratelimit.js';

const router = Router({ base: '/api/analytics' });
const ANALYTICS_MAX_PER_IP = 30;
const ANALYTICS_WINDOW_SECONDS = 60;
const MAX_METADATA_CHARS = 1000;

function boundedMetadata(metadata) {
  if (metadata === undefined || metadata === null) return null;
  let serialized;
  try {
    serialized = typeof metadata === 'string' ? metadata : JSON.stringify(metadata);
  } catch {
    return null;
  }
  return serialized.length > MAX_METADATA_CHARS ? serialized.slice(0, MAX_METADATA_CHARS) : serialized;
}

// POST /api/analytics/events — Non-blocking batch event ingestion
router.post('/events', async (request, env, ctx) => {
  const ip = getClientIP(request);
  const ipHash = await hashIP(ip);
  if (ipHash) {
    const rl = await checkRateLimit(env.ARENA_DB, `analytics:${ipHash}`, ANALYTICS_MAX_PER_IP, ANALYTICS_WINDOW_SECONDS);
    if (rl.limited) return errorResponse('Too many analytics events. Please slow down.', 429);
  }

  const body = await parseBody(request);
  if (!body || !body.events || !Array.isArray(body.events)) {
    return successResponse({ accepted: 0 }); // Don't error on analytics
  }

  const user = await authenticate(request, env);
  let sessionId = null;
  if (user) {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    const payload = token ? await verifyJWT(token, env) : null;
    sessionId = payload?.sessionId || null;
  }
  const events = body.events.slice(0, 50); // Cap at 50 per batch

  const inserts = events.map(e => {
    const id = generateId('evt');
    return env.ARENA_DB.prepare(
      `INSERT INTO analytics_events (id, event_type, user_id, session_id, race_id, candidate_id, content_type, content_id, metadata, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      e.event_type || 'unknown',
      user?.id || null,
      sessionId,
      e.race_id || null,
      e.candidate_id || null,
      e.content_type || null,
      e.content_id || null,
      boundedMetadata(e.metadata ?? e.event_data),
      ipHash,
    );
  });

  // Non-blocking write
  if (inserts.length > 0) {
    ctx.waitUntil(env.ARENA_DB.batch(inserts).catch(err => console.error('Analytics batch failed:', err)));
  }

  return successResponse({ accepted: events.length });
});

// GET /api/analytics/dashboard — Admin platform-wide metrics
router.get('/dashboard', async (request, env) => {
  const authError = await requireRole('admin', 'super_admin')(request, env);
  if (authError) return authError;

  const [users, races, ads, challenges, reactions, events] = await Promise.all([
    env.ARENA_DB.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN verification_status = 'verified' THEN 1 ELSE 0 END) as verified FROM users`).first(),
    env.ARENA_DB.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active FROM races`).first(),
    env.ARENA_DB.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active FROM ad_flights`).first(),
    env.ARENA_DB.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN status = 'responded' THEN 1 ELSE 0 END) as responded, SUM(CASE WHEN status = 'expired' AND notice_status != 'unserved' THEN 1 ELSE 0 END) as expired FROM challenges`).first(),
    env.ARENA_DB.prepare(`SELECT COUNT(*) as total FROM reactions`).first(),
    env.ARENA_DB.prepare(`SELECT COUNT(*) as total FROM analytics_events WHERE created_at > datetime('now', '-24 hours')`).first(),
  ]);

  return successResponse({
    users: { total: users.total, verified: users.verified },
    races: { total: races.total, active: races.active },
    ads: { total: ads.total, active: ads.active },
    challenges: { total: challenges.total, responded: challenges.responded, expired: challenges.expired },
    reactions_total: reactions.total,
    events_24h: events.total,
  });
});

// GET /api/analytics/race/:raceId/insights — Race-level insights
router.get('/race/:raceId/insights', async (request, env) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  // Admin or candidate staff with access
  const isAdmin = ['admin', 'super_admin'].includes(request.user.role);
  if (!isAdmin) {
    const link = await env.ARENA_DB.prepare(
      `SELECT csl.id FROM candidate_staff_links csl
       JOIN candidates c ON csl.candidate_id = c.id
       WHERE csl.user_id = ? AND c.race_id = ? AND csl.is_active = 1`
    ).bind(request.user.id, request.params.raceId).first();
    if (!link) return errorResponse('Not authorized', 403);
  }

  const { raceId } = request.params;

  const [adStats, challengeStats, priorityStats] = await Promise.all([
    env.ARENA_DB.prepare(
      `SELECT c.name, c.party, COUNT(af.id) as ad_count, SUM(af.total_impressions) as total_impressions
       FROM candidates c LEFT JOIN ad_flights af ON c.id = af.candidate_id AND af.status IN ('active','completed')
       WHERE c.race_id = ? AND c.is_active = 1 GROUP BY c.id`
    ).bind(raceId).all(),
    env.ARENA_DB.prepare(
      `SELECT status, COUNT(*) as count FROM challenges WHERE race_id = ? GROUP BY status`
    ).bind(raceId).all(),
    env.ARENA_DB.prepare(
      `SELECT ic.name, vip.party_affiliation as party, COUNT(*) as voters, AVG(vip.priority_rank) as avg_rank
       FROM voter_issue_priorities vip
       JOIN issue_categories ic ON vip.issue_category_id = ic.id
       WHERE vip.race_id = ? GROUP BY ic.id, vip.party_affiliation ORDER BY avg_rank`
    ).bind(raceId).all(),
  ]);

  return successResponse({
    ad_stats: adStats.results || [],
    challenge_stats: challengeStats.results || [],
    issue_priorities: priorityStats.results || [],
  });
});

// GET /api/analytics/candidate/:id/performance — Candidate self-analytics
router.get('/candidate/:id/performance', async (request, env) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const { id } = request.params;
  const isAdmin = ['admin', 'super_admin'].includes(request.user.role);
  if (!isAdmin) {
    const link = await env.ARENA_DB.prepare(
      `SELECT id FROM candidate_staff_links WHERE user_id = ? AND candidate_id = ? AND is_active = 1`
    ).bind(request.user.id, id).first();
    if (!link) return errorResponse('Not authorized', 403);
  }

  const [adPerf, challengePerf, reactionPerf] = await Promise.all([
    env.ARENA_DB.prepare(
      `SELECT COUNT(*) as total_ads, SUM(total_impressions) as impressions,
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active
       FROM ad_flights WHERE candidate_id = ?`
    ).bind(id).first(),
    env.ARENA_DB.prepare(
      `SELECT
        SUM(CASE WHEN challenger_candidate_id = ? THEN 1 ELSE 0 END) as issued,
        SUM(CASE WHEN target_candidate_id = ? AND status = 'responded' THEN 1 ELSE 0 END) as responded_to,
        SUM(CASE WHEN target_candidate_id = ? AND status = 'expired' AND notice_status != 'unserved' THEN 1 ELSE 0 END) as let_expire
       FROM challenges WHERE challenger_candidate_id = ? OR target_candidate_id = ?`
    ).bind(id, id, id, id, id).first(),
    env.ARENA_DB.prepare(
      `SELECT reaction_type, COUNT(*) as count FROM reactions
       WHERE (content_type = 'ad' AND content_id IN (SELECT id FROM ad_flights WHERE candidate_id = ?))
       OR (content_type = 'rebuttal' AND content_id IN (SELECT id FROM rebuttal_ads WHERE candidate_id = ?))
       GROUP BY reaction_type`
    ).bind(id, id).all(),
  ]);

  return successResponse({
    ads: adPerf,
    challenges: challengePerf,
    reactions: reactionPerf.results || [],
  });
});

export default router;
