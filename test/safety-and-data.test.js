/**
 * Safety cases, impression tracking, and archive-before-purge — real worker +
 * D1 + R2 in workerd. Added 2026-08-20 with the keep-and-track-all-data pass.
 */
import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { archiveAndPurge } from '../src/archive.js';

const BASE = 'https://example.com';
const VALID_PASSWORD = 'Str0ng!Passw0rd';
let seq = 0;

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await SELF.fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
const post = (p, b, t) => req('POST', p, b, t);
const get = (p, t) => req('GET', p, undefined, t);

async function registerUser(label) {
  seq += 1;
  const suffix = `${Date.now().toString(36)}${seq}`;
  const res = await post('/api/auth/register', {
    email: `${label}-${suffix}@example.com`,
    username: `sd_${label}_${suffix}`.slice(0, 30),
    password: VALID_PASSWORD,
    display_name: `SD ${label}`,
  });
  expect(res.status).toBe(200);
  return { token: res.body.data.token, id: res.body.data.user.id };
}

async function makeModerator(label) {
  const user = await registerUser(label);
  await env.ARENA_DB.prepare(
    `UPDATE users SET role = 'moderator', verification_status = 'verified', email_verified = 1 WHERE id = ?`
  ).bind(user.id).run();
  return user;
}

describe('safety cases', () => {
  it('voters cannot access safety endpoints', async () => {
    const voter = await registerUser('safevoter');
    expect((await get('/api/safety/cases', voter.token)).status).toBe(403);
    expect((await post('/api/safety/cases', { subject_type: 'user', subject_id: 'x', title: 'nope' }, voter.token)).status).toBe(403);
  });

  it('moderators open, annotate, escalate, and resolve a case with a full event trail', async () => {
    const moderator = await makeModerator('safemod');
    const target = await registerUser('safetarget');

    const created = await post('/api/safety/cases', {
      subject_type: 'user',
      subject_id: target.id,
      title: 'Repeated threatening messages toward a candidate',
      category: 'threat',
      severity: 'high',
      summary: 'Multiple hostile callout attempts referencing violence.',
    }, moderator.token);
    expect(created.status).toBe(200);
    const caseId = created.body.data.id;

    const list = await get('/api/safety/cases?status=open&severity=high', moderator.token);
    expect(list.body.data.cases.some(c => c.id === caseId)).toBe(true);

    expect((await post(`/api/safety/cases/${caseId}/events`, { note: 'Screenshots preserved; monitoring account.' }, moderator.token)).status).toBe(200);
    expect((await post(`/api/safety/cases/${caseId}/events`, { status: 'escalated' }, moderator.token)).status).toBe(200);
    expect((await post(`/api/safety/cases/${caseId}/events`, { evidence_url: 'https://evidence.example.com/item-1' }, moderator.token)).status).toBe(200);
    expect((await post(`/api/safety/cases/${caseId}/events`, { status: 'resolved' }, moderator.token)).status).toBe(200);

    const detail = await get(`/api/safety/cases/${caseId}`, moderator.token);
    expect(detail.status).toBe(200);
    expect(detail.body.data.case.status).toBe('resolved');
    const types = detail.body.data.events.map(e => e.event_type);
    expect(types).toContain('note');
    expect(types).toContain('status_change');
    expect(types).toContain('evidence');
    expect(detail.body.data.events.length).toBeGreaterThanOrEqual(5);
  });

  it('subject activity lookup returns cross-platform data and is audit-logged', async () => {
    const moderator = await makeModerator('safeact');
    const target = await registerUser('safeacttarget');

    const activity = await get(`/api/safety/subjects/user/${target.id}/activity`, moderator.token);
    expect(activity.status).toBe(200);
    expect(activity.body.data.account.id).toBe(target.id);
    expect(Array.isArray(activity.body.data.recent_sessions)).toBe(true);

    const auditRow = await env.ARENA_DB.prepare(
      `SELECT id FROM audit_log WHERE action = 'safety.activity_lookup' AND entity_id = ? AND actor_id = ?`
    ).bind(target.id, moderator.id).first();
    expect(auditRow).toBeTruthy();
  });

  it('rejects invalid subject types and statuses', async () => {
    const moderator = await makeModerator('safeinvalid');
    expect((await post('/api/safety/cases', { subject_type: 'planet', subject_id: 'x', title: 'bad type' }, moderator.token)).status).toBe(400);
    const created = await post('/api/safety/cases', { subject_type: 'other', subject_id: 'x', title: 'valid case' }, moderator.token);
    expect((await post(`/api/safety/cases/${created.body.data.id}/events`, { status: 'vanished' }, moderator.token)).status).toBe(400);
  });
});

describe('impression tracking', () => {
  it('ad_impression events feed impression_logs and the ad counter; spoofed ids are ignored', async () => {
    const before = await env.ARENA_DB.prepare(`SELECT total_impressions FROM ad_flights WHERE id = 'ad-1'`).first();
    const res = await post('/api/analytics/events', {
      events: [
        { event_type: 'ad_impression', content_type: 'ad', content_id: 'ad-1', race_id: 'race-1', candidate_id: 'cand-1' },
        { event_type: 'ad_impression', content_type: 'ad', content_id: 'ad-spoofed-does-not-exist', race_id: 'race-1', candidate_id: 'cand-1' },
        { event_type: 'rebuttal_impression', content_type: 'rebuttal', content_id: 'reb-1', race_id: 'race-1', candidate_id: 'cand-2' },
      ],
    });
    expect(res.status).toBe(200);

    // waitUntil writes land asynchronously — poll briefly
    let after = null;
    for (let i = 0; i < 20; i++) {
      after = await env.ARENA_DB.prepare(`SELECT total_impressions FROM ad_flights WHERE id = 'ad-1'`).first();
      if (after.total_impressions > (before.total_impressions || 0)) break;
      await new Promise(r => setTimeout(r, 100));
    }
    expect(after.total_impressions).toBe((before.total_impressions || 0) + 1);

    const log = await env.ARENA_DB.prepare(`SELECT COUNT(*) as total FROM impression_logs WHERE ad_id = 'ad-1'`).first();
    expect(log.total).toBeGreaterThanOrEqual(1);
    const rebLog = await env.ARENA_DB.prepare(`SELECT COUNT(*) as total FROM impression_logs WHERE rebuttal_id = 'reb-1'`).first();
    expect(rebLog.total).toBeGreaterThanOrEqual(1);
    const spoofed = await env.ARENA_DB.prepare(`SELECT COUNT(*) as total FROM impression_logs WHERE ad_id = 'ad-spoofed-does-not-exist'`).first();
    expect(spoofed.total).toBe(0);
  });
});

describe('archive before purge', () => {
  it('exports expiring rows to R2 as NDJSON and only then deletes them', async () => {
    await SELF.fetch(`${BASE}/api/health`); // ensure schema
    const oldId = `evt-archive-test-${Date.now()}`;
    await env.ARENA_DB.prepare(
      `INSERT INTO analytics_events (id, event_type, created_at) VALUES (?, 'archive_test', datetime('now', '-90 days'))`
    ).bind(oldId).run();

    const result = await archiveAndPurge(env, { table: 'analytics_events', cutoffModifier: '-30 days' });
    expect(result.archived).toBeGreaterThanOrEqual(1);

    const gone = await env.ARENA_DB.prepare(`SELECT id FROM analytics_events WHERE id = ?`).bind(oldId).first();
    expect(gone).toBeNull();

    const listing = await env.ARENA_MEDIA.list({ prefix: 'archives/analytics_events/' });
    expect(listing.objects.length).toBeGreaterThanOrEqual(1);
    const obj = await env.ARENA_MEDIA.get(listing.objects[listing.objects.length - 1].key);
    const text = await obj.text();
    expect(text).toContain(oldId);
  });
});
