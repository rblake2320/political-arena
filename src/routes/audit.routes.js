/**
 * Arena — Audit Log Routes
 * Admin-only access to immutable audit trail
 */

import { Router } from 'itty-router';
import { requireRole, errorResponse, successResponse, parsePagination } from '../middleware.js';
import { queryAuditLog, verifyAuditChain } from '../audit.js';

const router = Router({ base: '/api/audit' });

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
