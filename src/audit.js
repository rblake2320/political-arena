/**
 * Arena — Audit Logging Module
 * Append-only audit log for all state-changing operations.
 * Uses ctx.waitUntil() for non-blocking writes.
 */

import { generateId } from './db.js';

/**
 * Log an audit event (non-blocking via ctx.waitUntil)
 * @param {object} db - D1 database binding
 * @param {object} ctx - Worker execution context (for waitUntil)
 * @param {object} params - Audit event parameters
 */
export function auditLog(db, ctx, {
  actorId = null,
  actorType = 'user',
  action,
  entityType,
  entityId,
  beforeState = null,
  afterState = null,
  metadata = null,
  ipAddress = null,
}) {
  const id = generateId('aud');
  const promise = db.prepare(
    `INSERT INTO audit_log (id, actor_id, actor_type, action, entity_type, entity_id, before_state, after_state, metadata, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    actorId,
    actorType,
    action,
    entityType,
    entityId,
    beforeState ? JSON.stringify(beforeState) : null,
    afterState ? JSON.stringify(afterState) : null,
    metadata ? JSON.stringify(metadata) : null,
    ipAddress,
  ).run().catch(err => console.error('Audit log write failed:', err));

  // Non-blocking — don't make the request wait for the log write
  if (ctx && ctx.waitUntil) {
    ctx.waitUntil(promise);
  }

  return id;
}

/**
 * Query audit log entries
 */
export async function queryAuditLog(db, { entityType, entityId, action, actorId, limit = 50, offset = 0 }) {
  let sql = `SELECT * FROM audit_log WHERE 1=1`;
  const binds = [];

  if (entityType) { sql += ` AND entity_type = ?`; binds.push(entityType); }
  if (entityId) { sql += ` AND entity_id = ?`; binds.push(entityId); }
  if (action) { sql += ` AND action = ?`; binds.push(action); }
  if (actorId) { sql += ` AND actor_id = ?`; binds.push(actorId); }

  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  binds.push(limit, offset);

  const result = await db.prepare(sql).bind(...binds).all();
  return result.results || [];
}
