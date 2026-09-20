import { generateId } from './db.js';

function truncate(value, max = 180) {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function wantsEvent(subscription, eventType) {
  if (!subscription.notify_on) return true;
  try {
    const notifyOn = JSON.parse(subscription.notify_on);
    if (!Array.isArray(notifyOn) || notifyOn.length === 0) return true;
    return notifyOn.includes('all') || notifyOn.includes(eventType);
  } catch {
    return true;
  }
}

export async function notifySubscribers(db, {
  raceId = null,
  candidateIds = [],
  challengeId = null,
  notificationType,
  title,
  body,
  linkUrl,
  limit = 500,
}) {
  if (!notificationType || !title || !linkUrl) return 0;

  const conditions = [];
  const binds = [];
  if (raceId) {
    conditions.push(`(subscription_type = 'race' AND target_id = ?)`);
    binds.push(raceId);
  }

  const uniqueCandidateIds = [...new Set((candidateIds || []).filter(Boolean))];
  if (uniqueCandidateIds.length > 0) {
    conditions.push(`(subscription_type = 'candidate' AND target_id IN (${uniqueCandidateIds.map(() => '?').join(',')}))`);
    binds.push(...uniqueCandidateIds);
  }

  if (challengeId) {
    conditions.push(`(subscription_type = 'challenge' AND target_id = ?)`);
    binds.push(challengeId);
  }

  if (conditions.length === 0) return 0;
  binds.push(limit);

  const result = await db.prepare(
    `SELECT id, user_id, notify_on, channel
     FROM notification_subscriptions
     WHERE is_active = 1
       AND (${conditions.join(' OR ')})
     ORDER BY created_at ASC
     LIMIT ?`
  ).bind(...binds).all();

  const statements = [];
  for (const sub of result.results || []) {
    if (!wantsEvent(sub, notificationType)) continue;
    statements.push(db.prepare(
      `INSERT INTO notifications (id, user_id, subscription_id, notification_type, title, body, link_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      generateId('notif'),
      sub.user_id,
      sub.id,
      notificationType,
      title,
      truncate(body),
      linkUrl,
    ));
  }

  for (let i = 0; i < statements.length; i += 50) {
    await db.batch(statements.slice(i, i + 50));
  }

  return statements.length;
}
