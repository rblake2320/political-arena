/**
 * Arena — Data archival
 *
 * Retention policy without data loss: rows leaving D1 (analytics events,
 * impression logs) are exported to R2 as NDJSON before deletion. If the
 * archive write fails — or no R2 bucket is bound — nothing is deleted; the
 * data simply stays in D1 until the next successful archive run.
 *
 * Archive layout: archives/<table>/<YYYY-MM-DD>T<HHMMSS>-<n>.ndjson
 */

const PAGE_SIZE = 1000;
const MAX_PAGES_PER_RUN = 5; // bound cron CPU/time; the next tick continues

export async function archiveAndPurge(env, { table, cutoffModifier }) {
  const db = env.ARENA_DB;
  const bucket = env.ARENA_MEDIA;
  let archived = 0;
  let pages = 0;

  if (!bucket) {
    // No archive target — retain everything rather than destroy unarchived data.
    return { table, archived: 0, purged: 0, skipped: 'no R2 binding' };
  }

  const stamp = new Date().toISOString().replace(/[:]/g, '').replace(/\..+/, '');

  for (; pages < MAX_PAGES_PER_RUN; pages++) {
    const rows = await db.prepare(
      `SELECT * FROM ${table} WHERE created_at < datetime('now', ?) ORDER BY created_at LIMIT ${PAGE_SIZE}`
    ).bind(cutoffModifier).all();
    const batch = rows.results || [];
    if (batch.length === 0) break;

    const key = `archives/${table}/${stamp}-${pages}.ndjson`;
    const body = batch.map(r => JSON.stringify(r)).join('\n') + '\n';
    await bucket.put(key, body, {
      httpMetadata: { contentType: 'application/x-ndjson' },
      customMetadata: { table, rows: String(batch.length), cutoff: cutoffModifier },
    });

    // Only after the archive object is durably written do we delete — by id,
    // chunked under D1's 100-bound-parameter limit.
    const ids = batch.map(r => r.id);
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      const placeholders = chunk.map(() => '?').join(',');
      await db.prepare(`DELETE FROM ${table} WHERE id IN (${placeholders})`).bind(...chunk).run();
    }
    archived += batch.length;

    if (batch.length < PAGE_SIZE) break;
  }

  return { table, archived, purged: archived };
}
