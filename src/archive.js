/**
 * Arena — Data archival
 *
 * Retention policy without data loss: rows leaving D1 (analytics events,
 * impression logs) are exported to R2 as NDJSON before deletion. If the
 * archive write for a page fails — or no R2 bucket is bound — that page is
 * not deleted; its rows stay in D1 until the next successful archive run.
 *
 * Archive layout: archives/<table>/<YYYY-MM-DD>T<HHMMSS>-<run UUID>-<n>.ndjson
 */

const PAGE_SIZE = 1000;
const MAX_PAGES_PER_RUN = 5; // bound cron CPU/time; the next tick continues
const RETENTION_TABLES = new Set(['analytics_events', 'impression_logs']);

export async function archiveAndPurge(env, { table, cutoffModifier }) {
  if (!RETENTION_TABLES.has(table)) throw new Error(`Unsupported retention table: ${table}`);
  const db = env.ARENA_DB;
  const bucket = env.ARENA_MEDIA;
  let archived = 0;
  let purged = 0;
  let pages = 0;

  if (!bucket) {
    // No archive target — retain everything rather than destroy unarchived data.
    return { table, archived: 0, purged: 0, skipped: 'no R2 binding' };
  }

  const stamp = new Date().toISOString().replace(/[:]/g, '').replace(/\..+/, '');
  // Cron deliveries and retries can overlap within the same second. Never
  // overwrite an earlier export after its source rows have been deleted.
  const runId = crypto.randomUUID();

  for (; pages < MAX_PAGES_PER_RUN; pages++) {
    const rows = await db.prepare(
      `SELECT * FROM ${table} WHERE created_at < datetime('now', ?) ORDER BY created_at, id LIMIT ${PAGE_SIZE}`
    ).bind(cutoffModifier).all();
    const batch = rows.results || [];
    if (batch.length === 0) break;

    const key = `archives/${table}/${stamp}-${runId}-${pages}.ndjson`;
    const body = batch.map(r => JSON.stringify(r)).join('\n') + '\n';
    const object = await bucket.put(key, body, {
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: 'application/x-ndjson' },
      customMetadata: { table, rows: String(batch.length), cutoff: cutoffModifier },
    });
    if (!object) throw new Error(`Archive write refused: ${key}; source rows retained`);
    archived += batch.length;

    // Only after the archive object is durably written do we delete — by id,
    // chunked under D1's 100-bound-parameter limit.
    const ids = batch.map(r => r.id);
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      const placeholders = chunk.map(() => '?').join(',');
      const result = await db.prepare(`DELETE FROM ${table} WHERE id IN (${placeholders})`).bind(...chunk).run();
      purged += result.meta.changes;
    }

    if (batch.length < PAGE_SIZE) break;
  }

  return { table, archived, purged };
}
