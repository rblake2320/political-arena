/**
 * Arena — Audit Log Routes
 * Admin-only access to immutable audit trail
 */

import { Router } from 'itty-router';
import { requireRole, errorResponse, successResponse, parseBody, parsePagination, getClientIP } from '../middleware.js';
import { auditLogNow, listAuditAnchors, publishAuditAnchor, queryAuditLog, verifyAuditChain } from '../audit.js';

const router = Router({ base: '/api/audit' });

// GET /api/audit/anchors — Published audit roots (admin only)
router.get('/anchors', async (request, env) => {
  const authError = await requireRole('admin', 'super_admin')(request, env);
  if (authError) return authError;

  const url = new URL(request.url);
  const { limit, offset } = parsePagination(url);
  const anchors = await listAuditAnchors(env.ARENA_DB, {
    entityType: url.searchParams.get('entity_type'),
    entityId: url.searchParams.get('entity_id'),
    limit,
    offset,
  });

  return successResponse({ anchors, page: Math.floor(offset / limit) + 1, limit });
});

// POST /api/audit/anchors — Publish latest audit root to R2 (admin only)
router.post('/anchors', async (request, env) => {
  const authError = await requireRole('admin', 'super_admin')(request, env);
  if (authError) return authError;
  if (!env.ARENA_MEDIA) return errorResponse('Audit anchor storage is not configured', 503);

  const body = await parseBody(request).catch(() => ({}));
  const scopeType = body.scope_type || 'global';
  if (!['global', 'entity'].includes(scopeType)) return errorResponse('Invalid scope_type', 400);
  if (scopeType === 'entity' && (!body.entity_type || !body.entity_id)) {
    return errorResponse('entity_type and entity_id required for entity anchors', 400);
  }

  try {
    const anchor = await publishAuditAnchor(env.ARENA_DB, env.ARENA_MEDIA, {
      actorId: request.user.id,
      scopeType,
      entityType: body.entity_type || null,
      entityId: body.entity_id || null,
    });

    await auditLogNow(env.ARENA_DB, {
      actorId: request.user.id,
      action: 'audit.anchor.publish',
      entityType: 'audit_anchor',
      entityId: anchor.id,
      afterState: {
        scope_type: anchor.scope_type,
        entity_type: anchor.entity_type,
        entity_id: anchor.entity_id,
        entry_count: anchor.entry_count,
        merkle_root: anchor.merkle_root,
        manifest_hash: anchor.manifest_hash,
        storage_key: anchor.storage_key,
      },
      ipAddress: getClientIP(request),
    });

    return successResponse({ anchor });
  } catch (error) {
    const message = String(error?.message || error);
    return errorResponse(message, message.includes('No hash-chain entries') ? 400 : 500);
  }
});

// GET /api/audit — Filterable audit log (admin only)
router.get('/', async (request, env) => {
  const authError = await requireRole('admin', 'super_admin')(request, env);
  if (authError) return authError;

  const url = new URL(request.url);
  const { limit, offset } = parsePagination(url);

  const entries = await queryAuditLog(env.ARENA_DB, {
    entityType: url.searchParams.get('entity_type'),
    entityId: url.searchParams.get('entity_id'),
    action: url.searchParams.get('action'),
    actorId: url.searchParams.get('actor_id'),
    limit,
    offset,
  });

  return successResponse({ entries });
});

// GET /api/audit/:entityType/:entityId — Audit trail for specific entity
router.get('/:entityType/:entityId', async (request, env) => {
  const authError = await requireRole('admin', 'super_admin')(request, env);
  if (authError) return authError;

  const { entityType, entityId } = request.params;
  const [entries, chain] = await Promise.all([
    queryAuditLog(env.ARENA_DB, { entityType, entityId, limit: 100 }),
    verifyAuditChain(env.ARENA_DB, { entityType, entityId }),
  ]);

  return successResponse({ entries, chain });
});

export default router;
