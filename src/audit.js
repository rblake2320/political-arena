/**
 * Arena — Audit Logging Module
 * Append-only audit log for all state-changing operations.
 * Uses ctx.waitUntil() for non-blocking writes.
 */

import { generateId } from './db.js';

const HASH_ALGORITHM = 'SHA-256';

function normalizeForHash(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(normalizeForHash);

  return Object.keys(value).sort().reduce((normalized, key) => {
    const normalizedValue = normalizeForHash(value[key]);
    if (normalizedValue !== undefined) normalized[key] = normalizedValue;
    return normalized;
  }, {});
}

function canonicalJson(value) {
  return JSON.stringify(normalizeForHash(value));
}

function serializeAuditState(value) {
  return value == null ? null : canonicalJson(value);
}

function buildAuditEventData(row) {
  return {
    id: row.id,
    actor_id: row.actor_id ?? null,
    actor_type: row.actor_type,
    action: row.action,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    before_state: row.before_state ?? null,
    after_state: row.after_state ?? null,
    metadata: row.metadata ?? null,
    ip_address: row.ip_address ?? null,
    created_at: row.created_at,
  };
}

async function sha256Hex(input) {
  const digest = await crypto.subtle.digest(HASH_ALGORITHM, new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function merkleRoot(hashes) {
  if (hashes.length === 0) return null;
  let layer = [...hashes];
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = layer[i + 1] || left;
      next.push(await sha256Hex(canonicalJson({ left, right })));
    }
    layer = next;
  }
  return layer[0];
}

async function computeAuditEntryHash(prevHash, row) {
  return sha256Hex(canonicalJson({
    prev_hash: prevHash ?? null,
    timestamp: row.created_at,
    event_data: buildAuditEventData(row),
  }));
}

async function persistAuditLogEntry(db, row) {
  const previous = await db.prepare(
    `SELECT entry_hash, chain_seq
     FROM audit_log
     WHERE entity_type = ? AND entity_id = ? AND chain_seq IS NOT NULL
     ORDER BY chain_seq DESC
     LIMIT 1`
  ).bind(row.entity_type, row.entity_id).first();

  const prevHash = previous?.entry_hash || null;
  const chainSeq = (previous?.chain_seq || 0) + 1;
  const entryHash = await computeAuditEntryHash(prevHash, row);

  await db.prepare(
    `INSERT INTO audit_log
     (id, actor_id, actor_type, action, entity_type, entity_id, before_state, after_state, metadata, ip_address, prev_hash, entry_hash, chain_seq, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.id,
    row.actor_id,
    row.actor_type,
    row.action,
    row.entity_type,
    row.entity_id,
    row.before_state,
    row.after_state,
    row.metadata,
    row.ip_address,
    prevHash,
    entryHash,
    chainSeq,
    row.created_at,
  ).run();

  return { id: row.id, prev_hash: prevHash, entry_hash: entryHash, chain_seq: chainSeq };
}

function buildAuditRow({
  id = generateId('aud'),
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
  return {
    id,
    actor_id: actorId,
    actor_type: actorType,
    action,
    entity_type: entityType,
    entity_id: entityId,
    before_state: serializeAuditState(beforeState),
    after_state: serializeAuditState(afterState),
    metadata: serializeAuditState(metadata),
    ip_address: ipAddress,
    created_at: new Date().toISOString(),
  };
}

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
  const row = buildAuditRow({
    actorId,
    actorType,
    action,
    entityType,
    entityId,
    beforeState,
    afterState,
    metadata,
    ipAddress,
  });
  const promise = persistAuditLogEntry(db, row)
    .catch(err => console.error('Audit log write failed:', err));

  // Non-blocking — don't make the request wait for the log write
  if (ctx && ctx.waitUntil) {
    ctx.waitUntil(promise);
  }

  return row.id;
}

/**
 * Log an audit event and wait for it to be durably written.
 * Use this when a route immediately reads the same entity's receipt chain.
 */
export async function auditLogNow(db, params) {
  const row = buildAuditRow(params);
  await persistAuditLogEntry(db, row);
  return row.id;
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

/**
 * Verify a chronological audit chain for one audited entity.
 */
export async function verifyAuditChain(db, { entityType, entityId }) {
  const result = await db.prepare(
    `SELECT *
     FROM audit_log
     WHERE entity_type = ? AND entity_id = ?
     ORDER BY chain_seq ASC, created_at ASC, id ASC`
  ).bind(entityType, entityId).all();

  const entries = result.results || [];
  let expectedPrevHash = null;
  let checkedEntries = 0;
  let legacyEntries = 0;
  const failures = [];

  for (const entry of entries) {
    if (entry.chain_seq == null) {
      legacyEntries += 1;
      expectedPrevHash = null;
      continue;
    }

    if (!entry.entry_hash) {
      if (entry.prev_hash) {
        failures.push({ id: entry.id, reason: 'incomplete hash chain fields' });
      } else {
        legacyEntries += 1;
      }
      expectedPrevHash = null;
      continue;
    }

    if ((entry.prev_hash ?? null) !== expectedPrevHash) {
      failures.push({ id: entry.id, reason: 'previous hash mismatch' });
    }

    const expectedEntryHash = await computeAuditEntryHash(entry.prev_hash ?? null, entry);
    if (entry.entry_hash !== expectedEntryHash) {
      failures.push({ id: entry.id, reason: 'entry hash mismatch' });
    }

    expectedPrevHash = entry.entry_hash;
    checkedEntries += 1;
  }

  const status = failures.length > 0
    ? 'failed'
    : legacyEntries > 0
      ? 'partial'
      : checkedEntries > 0
        ? 'verified'
        : 'empty';

  return {
    status,
    verified: status === 'verified',
    checked_entries: checkedEntries,
    legacy_entries: legacyEntries,
    total_entries: entries.length,
    latest_hash: expectedPrevHash,
    failures,
  };
}

function anchorStorageKey(anchorId, anchoredAt) {
  const day = anchoredAt.slice(0, 10).replace(/-/g, '/');
  return `audit-anchors/${day}/${anchorId}.json`;
}

async function selectAnchorEntries(db, { scopeType = 'global', entityType = null, entityId = null } = {}) {
  let sql = `SELECT id, action, entity_type, entity_id, chain_seq, entry_hash, created_at
             FROM audit_log
             WHERE entry_hash IS NOT NULL AND chain_seq IS NOT NULL`;
  const binds = [];

  if (scopeType === 'entity') {
    sql += ` AND entity_type = ? AND entity_id = ?`;
    binds.push(entityType, entityId);
  }

  sql += ` ORDER BY created_at ASC, id ASC`;
  const result = await db.prepare(sql).bind(...binds).all();
  return result.results || [];
}

/**
 * Publish a DB audit root to external object storage.
 * This does not make old entries tamper-proof by itself; the R2 bucket must
 * have Bucket Lock / WORM retention enabled for the returned object key.
 */
export async function publishAuditAnchor(db, bucket, {
  actorId = null,
  scopeType = 'global',
  entityType = null,
  entityId = null,
} = {}) {
  if (!bucket) throw new Error('Audit anchor storage is not configured');
  if (!['global', 'entity'].includes(scopeType)) throw new Error('Invalid audit anchor scope');
  if (scopeType === 'entity' && (!entityType || !entityId)) {
    throw new Error('entity_type and entity_id are required for entity anchors');
  }

  const entries = await selectAnchorEntries(db, { scopeType, entityType, entityId });
  if (entries.length === 0) throw new Error('No hash-chain entries available to anchor');

  const anchoredAt = new Date().toISOString();
  const anchorId = generateId('anch');
  const root = await merkleRoot(entries.map(row => row.entry_hash));
  const manifest = {
    schema_version: 1,
    anchor_id: anchorId,
    anchor_type: 'r2_object',
    scope: {
      scope_type: scopeType,
      entity_type: scopeType === 'entity' ? entityType : null,
      entity_id: scopeType === 'entity' ? entityId : null,
    },
    anchored_at: anchoredAt,
    entry_count: entries.length,
    from_created_at: entries[0].created_at,
    through_created_at: entries[entries.length - 1].created_at,
    merkle_root: root,
    entries: entries.map(row => ({
      audit_log_id: row.id,
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      chain_seq: row.chain_seq,
      entry_hash: row.entry_hash,
      created_at: row.created_at,
    })),
  };
  const manifestJson = canonicalJson(manifest);
  const manifestHash = await sha256Hex(manifestJson);
  const storageKey = anchorStorageKey(anchorId, anchoredAt);

  await bucket.put(storageKey, manifestJson, {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: {
      anchor_id: anchorId,
      merkle_root: root,
      manifest_hash: manifestHash,
      scope_type: scopeType,
    },
  });

  const statements = [
    db.prepare(
      `INSERT INTO audit_anchors
       (id, anchor_type, scope_type, entity_type, entity_id, entry_count,
        from_created_at, through_created_at, merkle_root, manifest_hash,
        storage_provider, storage_key, created_by, anchored_at)
       VALUES (?, 'r2_object', ?, ?, ?, ?, ?, ?, ?, ?, 'r2', ?, ?, ?)`
    ).bind(
      anchorId,
      scopeType,
      scopeType === 'entity' ? entityType : null,
      scopeType === 'entity' ? entityId : null,
      entries.length,
      entries[0].created_at,
      entries[entries.length - 1].created_at,
      root,
      manifestHash,
      storageKey,
      actorId,
      anchoredAt,
    ),
    ...entries.map(row => db.prepare(
      `INSERT INTO audit_anchor_entries
       (anchor_id, audit_log_id, entity_type, entity_id, chain_seq, entry_hash, audit_created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(anchorId, row.id, row.entity_type, row.entity_id, row.chain_seq, row.entry_hash, row.created_at)),
  ];

  await db.batch(statements);

  return {
    id: anchorId,
    anchor_type: 'r2_object',
    scope_type: scopeType,
    entity_type: scopeType === 'entity' ? entityType : null,
    entity_id: scopeType === 'entity' ? entityId : null,
    entry_count: entries.length,
    from_created_at: entries[0].created_at,
    through_created_at: entries[entries.length - 1].created_at,
    merkle_root: root,
    manifest_hash: manifestHash,
    storage_provider: 'r2',
    storage_key: storageKey,
    anchored_at: anchoredAt,
    proof_note: 'External proof requires R2 Bucket Lock or another retention policy on this object key.',
  };
}

export async function listAuditAnchors(db, {
  entityType = null,
  entityId = null,
  limit = 20,
  offset = 0,
} = {}) {
  if (entityType && entityId) {
    const result = await db.prepare(
      `SELECT DISTINCT aa.*
       FROM audit_anchors aa
       JOIN audit_anchor_entries aae ON aae.anchor_id = aa.id
       WHERE aae.entity_type = ? AND aae.entity_id = ?
       ORDER BY aa.anchored_at DESC
       LIMIT ? OFFSET ?`
    ).bind(entityType, entityId, limit, offset).all();
    return result.results || [];
  }

  const result = await db.prepare(
    `SELECT *
     FROM audit_anchors
     ORDER BY anchored_at DESC
     LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();
  return result.results || [];
}
