import { SELF, env } from 'cloudflare:test';
import worker from '../src/worker.js';
import { beforeAll, describe, expect, it } from 'vitest';

const BASE = 'https://example.com';
const VALID_PASSWORD = 'Str0ng!Passw0rd';
let seq = 0;

async function api(method, path, body, token) {
  const headers = {};
  const init = { method, headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await SELF.fetch(`${BASE}${path}`, init);
  return { status: res.status, body: await res.json() };
}

async function registerUser(label) {
  seq += 1;
  const suffix = `${Date.now().toString(36)}${seq}`;
  const res = await api('POST', '/api/auth/register', {
    email: `${label}-${suffix}@example.com`,
    username: `watch_${label}_${seq}`.slice(0, 30),
    password: VALID_PASSWORD,
    display_name: `Watch ${label}`,
  });
  expect(res.status).toBe(200);
  return { token: res.body.data.token, id: res.body.data.user.id };
}

async function makeVerifiedVoter(label) {
  const user = await registerUser(label);
  await env.ARENA_DB.prepare(
    `UPDATE users SET verification_status = 'verified', email_verified = 1 WHERE id = ?`
  ).bind(user.id).run();
  return user;
}

describe('watchlist subscriptions', () => {
  beforeAll(async () => {
    await SELF.fetch(`${BASE}/api/health`);
  });

  it('notifies watched races when new questions are submitted', async () => {
    const watcher = await registerUser('questionwatcher');
    const submitter = await makeVerifiedVoter('questionsubmitter');
    const questionText = `What metric will you publish for rural hospital access ${Date.now()}?`;

    const sub = await api('POST', '/api/notifications/subscribe', {
      subscription_type: 'race',
      target_id: 'race-1',
    }, watcher.token);
    expect(sub.status).toBe(200);

    const question = await api('POST', '/api/questions/race-1', {
      source_type: 'voter',
      question_text: questionText,
    }, submitter.token);
    expect(question.status).toBe(200);

    const notifications = await api('GET', '/api/notifications', undefined, watcher.token);
    expect(notifications.status).toBe(200);
    expect(notifications.body.data.notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({
        notification_type: 'question_submitted',
        title: 'Voter question submitted',
        body: questionText,
        link_url: '/race/race-1',
      }),
    ]));
  });
  it('honors event preferences and inactive subscriptions', async () => {
    const watcher = await registerUser('filtered');
    const submitter = await makeVerifiedVoter('filteredposter');
    const sub = await api('POST', '/api/notifications/subscribe', {
      subscription_type: 'race', target_id: 'race-1', notify_on: ['challenge_issued'],
    }, watcher.token);
    expect(sub.status).toBe(200);
    const postQuestion = () => api('POST', '/api/questions/race-1', {
      source_type: 'voter', question_text: `What are the concrete transit goals ${crypto.randomUUID()}?`,
    }, submitter.token);
    expect((await postQuestion()).status).toBe(200);
    expect((await api('GET', '/api/notifications', undefined, watcher.token)).body.data.notifications).toHaveLength(0);
    await env.ARENA_DB.prepare(`UPDATE notification_subscriptions SET notify_on = '["question_submitted"]', is_active = 0 WHERE id = ?`).bind(sub.body.data.id).run();
    expect((await postQuestion()).status).toBe(200);
    expect((await api('GET', '/api/notifications', undefined, watcher.token)).body.data.notifications).toHaveLength(0);
  });

  it('cron notifies actual served expirations and ad activations exactly once across repeat runs', async () => {
    const watcher = await registerUser('cronwatch');
    expect((await api('POST', '/api/notifications/subscribe', {
      subscription_type: 'race', target_id: 'race-1', notify_on: ['challenge_expired', 'ad_activated'],
    }, watcher.token)).status).toBe(200);
    const marker = crypto.randomUUID();
    for (const [suffix, notice] of [['served', 'in_app'], ['unserved', 'unserved']]) {
      await env.ARENA_DB.prepare(`INSERT INTO challenges
        (id, race_id, challenger_candidate_id, target_candidate_id, created_by, challenge_text, challenge_type, status, notice_status, response_deadline)
        VALUES (?, 'race-1', 'cand-1', 'cand-2', ?, ?, 'policy_question', 'open', ?, datetime('now', '-1 day'))`)
        .bind(`${marker}-${suffix}`, watcher.id, `${marker}-${suffix}`, notice).run();
    }
    await env.ARENA_DB.prepare(`INSERT INTO ad_flights
      (id, race_id, candidate_id, created_by, title, ad_content_text, disclaimer_text, media_type, status, start_date)
      VALUES (?, 'race-1', 'cand-1', ?, ?, 'Scheduled ad', 'Paid for by Test Committee', 'text', 'approved', datetime('now', '-1 hour'))`)
      .bind(`${marker}-ad`, watcher.id, `${marker}-ad`).run();
    const cronEnv = { ...env, PRESS_FEED_RSS_SOURCES: 'disabled' };
    await worker.scheduled({ cron: '*/15 * * * *' }, cronEnv, {});
    await worker.scheduled({ cron: '*/15 * * * *' }, cronEnv, {});
    const { results } = await env.ARENA_DB.prepare(`SELECT notification_type, body FROM notifications WHERE user_id = ? AND body LIKE ?`)
      .bind(watcher.id, `${marker}%`).all();
    expect(results).toEqual(expect.arrayContaining([
      { notification_type: 'challenge_expired', body: `${marker}-served` },
      { notification_type: 'ad_activated', body: `${marker}-ad` },
    ]));
    expect(results).toHaveLength(2);
    expect((await env.ARENA_DB.prepare(`SELECT status FROM challenges WHERE id = ?`).bind(`${marker}-unserved`).first()).status).toBe('open');
  });

});
