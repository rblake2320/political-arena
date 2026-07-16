function parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Ceiling on saved items returned per list call; keeps the per-type IN(...)
// enrichment queries bounded no matter how many rows a user accumulates.
export const SAVED_ITEMS_LIST_LIMIT = 200;

export async function savedTargetExists(env, targetType, targetId) {
  if (targetType === 'race') {
    return !!(await env.ARENA_DB.prepare(`SELECT id FROM races WHERE id = ?`).bind(targetId).first());
  }
  if (targetType === 'candidate') {
    return !!(await env.ARENA_DB.prepare(
      `SELECT id FROM candidates WHERE id = ? AND is_active = 1`
    ).bind(targetId).first());
  }
  if (targetType === 'challenge') {
    return !!(await env.ARENA_DB.prepare(
      `SELECT id FROM challenges WHERE id = ? AND is_visible = 1`
    ).bind(targetId).first());
  }
  return false;
}

async function fetchTargetsByType(env, targetType, targetIds) {
  if (targetIds.length === 0) return [];
  const placeholders = targetIds.map(() => '?').join(',');

  if (targetType === 'race') {
    const result = await env.ARENA_DB.prepare(
      `SELECT r.id, r.name, r.office, r.state, r.district, r.status, r.election_date,
              (SELECT COUNT(*) FROM candidates c WHERE c.race_id = r.id AND c.is_active = 1) as candidate_count,
              (SELECT COUNT(*) FROM challenges ch WHERE ch.race_id = r.id AND ch.status = 'open' AND ch.is_visible = 1) as open_callouts,
              (SELECT MAX(created_at) FROM challenges ch WHERE ch.race_id = r.id AND ch.is_visible = 1) as latest_callout_at
       FROM races r
       WHERE r.id IN (${placeholders})`
    ).bind(...targetIds).all();
    return result.results || [];
  }

  if (targetType === 'candidate') {
    const result = await env.ARENA_DB.prepare(
      `SELECT c.id, c.name, c.party, c.race_id, c.verification_status, c.source_status,
              c.source_label, c.photo_url, c.website_url,
              r.name as race_name, r.office as race_office, r.state as race_state, r.district as race_district
       FROM candidates c
       JOIN races r ON r.id = c.race_id
       WHERE c.id IN (${placeholders}) AND c.is_active = 1`
    ).bind(...targetIds).all();
    return result.results || [];
  }

  if (targetType === 'challenge') {
    const result = await env.ARENA_DB.prepare(
      `SELECT ch.id, ch.race_id, ch.status, ch.claim_text, ch.challenge_text,
              ch.response_deadline, ch.public_receipt_slug, ch.created_at,
              challenger.name as challenger_name,
              target.name as target_name,
              r.name as race_name, r.office as race_office, r.state as race_state, r.district as race_district
       FROM challenges ch
       JOIN candidates challenger ON challenger.id = ch.challenger_candidate_id
       JOIN candidates target ON target.id = ch.target_candidate_id
       JOIN races r ON r.id = ch.race_id
       WHERE ch.id IN (${placeholders}) AND ch.is_visible = 1`
    ).bind(...targetIds).all();
    return result.results || [];
  }

  return [];
}

function groupKey(targetType) {
  if (targetType === 'race') return 'races';
  if (targetType === 'candidate') return 'candidates';
  return 'challenges';
}

export async function enrichSavedItems(env, rows, typeField) {
  const sourceRows = rows || [];

  // One IN(...) query per target type instead of one query per saved row.
  const idsByType = new Map();
  for (const row of sourceRows) {
    const targetType = row[typeField];
    if (!idsByType.has(targetType)) idsByType.set(targetType, new Set());
    idsByType.get(targetType).add(row.target_id);
  }

  const targetsByType = new Map();
  await Promise.all([...idsByType.entries()].map(async ([targetType, ids]) => {
    const targets = await fetchTargetsByType(env, targetType, [...ids]);
    targetsByType.set(targetType, new Map(targets.map(t => [t.id, t])));
  }));

  const items = sourceRows.map(row => {
    const targetType = row[typeField];
    const target = targetsByType.get(targetType)?.get(row.target_id) || null;
    const item = {
      ...row,
      target_type: targetType,
      notify_on: row.notify_on ? parseJsonArray(row.notify_on) : undefined,
      target,
    };
    if (!target) item.missing_target = true;
    return item;
  });

  const grouped = { races: [], candidates: [], challenges: [] };
  for (const item of items) {
    grouped[groupKey(item.target_type)].push(item);
  }

  return { items, grouped };
}
