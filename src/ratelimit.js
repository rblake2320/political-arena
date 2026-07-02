/**
 * Arena — Rate Limiting Module
 * Fixed-window rate limiter backed by D1.
 * Single atomic UPSERT per check — no read-then-write race.
 * Expired windows are reaped by the cron handler.
 */

/**
 * Count a hit against `key` and report whether the limit is exceeded.
 * @param {object} db - D1 binding
 * @param {string} key - bucket key, e.g. "login:<ipHash>"
 * @param {number} max - max hits allowed per window
 * @param {number} windowSeconds - window length in seconds
 * @returns {Promise<{limited: boolean, count: number, resetAt: string}>}
 */
export async function checkRateLimit(db, key, max, windowSeconds) {
  const windowModifier = `+${Math.max(1, Math.floor(windowSeconds))} seconds`;
  const row = await db.prepare(
    `INSERT INTO auth_rate_limits (key, count, reset_at)
     VALUES (?1, 1, datetime('now', ?2))
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN reset_at <= datetime('now') THEN 1 ELSE count + 1 END,
       reset_at = CASE WHEN reset_at <= datetime('now') THEN datetime('now', ?2) ELSE reset_at END
     RETURNING count, reset_at`
  ).bind(key, windowModifier).first();

  return {
    limited: row.count > max,
    count: row.count,
    resetAt: row.reset_at,
  };
}

/**
 * Clear a rate-limit bucket (e.g. after a successful login, so legitimate
 * users who mistyped a few times are not locked out of their next session).
 */
export async function clearRateLimit(db, key) {
  await db.prepare(`DELETE FROM auth_rate_limits WHERE key = ?`).bind(key).run();
}
