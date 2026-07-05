import { SELF, env } from 'cloudflare:test';
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

  it('returns enriched watched races, candidates, and callouts', async () => {
    const watcher = await registerUser('enriched');

    const anonymous = await api('GET', '/api/notifications/my-subscriptions');
    expect(anonymous.status).toBe(401);

    const raceSub = await api('POST', '/api/notifications/subscribe', {
      subscription_type: 'race',
      target_id: 'race-1',
    }, watcher.token);
    expect(raceSub.status).toBe(200);

    const candidateSub = await api('POST', '/api/notifications/subscribe', {
      subscription_type: 'candidate',
      target_id: 'cand-1',
    }, watcher.token);
    expect(candidateSub.status).toBe(200);

    const challengeSub = await api('POST', '/api/notifications/subscribe', {
      subscription_type: 'challenge',
      target_id: 'chal-1',
    }, watcher.token);
    expect(challengeSub.status).toBe(200);

    const duplicate = await api('POST', '/api/notifications/subscribe', {
      subscription_type: 'race',
      target_id: 'race-1',
    }, watcher.token);
    expect(duplicate.status).toBe(409);

    const list = await api('GET', '/api/notifications/my-subscriptions', undefined, watcher.token);
    expect(list.status).toBe(200);
    const subscriptions = list.body.data.subscriptions;

    expect(subscriptions.find(sub => sub.subscription_type === 'race' && sub.target_id === 'race-1')).toMatchObject({
      target_label: expect.any(String),
      target_href: '/race/race-1',
      race_state: expect.any(String),
      notify_on: expect.arrayContaining(['challenge_issued', 'question_submitted']),
    });
    expect(subscriptions.find(sub => sub.subscription_type === 'candidate' && sub.target_id === 'cand-1')).toMatchObject({
      target_label: expect.any(String),
      target_href: '/profile/candidate/cand-1',
      candidate_party: expect.any(String),
    });
    expect(subscriptions.find(sub => sub.subscription_type === 'challenge' && sub.target_id === 'chal-1')).toMatchObject({
      target_label: expect.any(String),
      target_href: expect.stringMatching(/^\/challenge\//),
      challenger_name: expect.any(String),
      target_name: expect.any(String),
    });

    const removed = await api('DELETE', `/api/notifications/subscribe/${raceSub.body.data.id}`, undefined, watcher.token);
    expect(removed.status).toBe(200);

    const afterRemove = await api('GET', '/api/notifications/my-subscriptions', undefined, watcher.token);
    expect(afterRemove.body.data.subscriptions.some(sub => sub.id === raceSub.body.data.id)).toBe(false);
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
});
