/**
 * Saved-items integration tests — real worker, real D1.
 * Covers /api/favorites and /api/notifications/watchlist, including the
 * batched target enrichment in saved-items.helpers.js.
 */
import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'https://example.com';
const VALID_PASSWORD = 'Str0ng!Passw0rd';
let seq = 0;

async function request(method, path, body, token) {
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

const post = (path, body, token) => request('POST', path, body, token);
const get = (path, token) => request('GET', path, undefined, token);
const del = (path, token) => request('DELETE', path, undefined, token);

async function registerUser(label) {
  seq += 1;
  const suffix = `${Date.now().toString(36)}${seq}`;
  const username = `saved_${label}_${seq}`.slice(0, 30);
  const res = await post('/api/auth/register', {
    email: `${label}-${suffix}@example.com`,
    username,
    password: VALID_PASSWORD,
    display_name: `Saved ${label}`,
  });
  expect(res.status).toBe(200);
  return { token: res.body.data.token, id: res.body.data.user.id, username };
}

describe('favorites and watchlist', () => {
  let raceId;
  let candidateId;
  let challengeId;

  beforeAll(async () => {
    await SELF.fetch(`${BASE}/api/health`);
    raceId = (await env.ARENA_DB.prepare(`SELECT id FROM races LIMIT 1`).first()).id;
    candidateId = (await env.ARENA_DB.prepare(`SELECT id FROM candidates WHERE is_active = 1 LIMIT 1`).first()).id;
    challengeId = (await env.ARENA_DB.prepare(`SELECT id FROM challenges WHERE is_visible = 1 LIMIT 1`).first()).id;
  });

  it('saves and lists favorites across all target types with enriched targets', async () => {
    const user = await registerUser('happy');

    for (const [favorite_type, target_id] of [['race', raceId], ['candidate', candidateId], ['challenge', challengeId]]) {
      const res = await post('/api/favorites', { favorite_type, target_id }, user.token);
      expect(res.status).toBe(200);
    }

    const list = await get('/api/favorites', user.token);
    expect(list.status).toBe(200);
    expect(list.body.data.favorites).toHaveLength(3);
    expect(list.body.data.grouped.races).toHaveLength(1);
    expect(list.body.data.grouped.candidates).toHaveLength(1);
    expect(list.body.data.grouped.challenges).toHaveLength(1);

    // Enrichment must resolve real targets, not nulls
    for (const item of list.body.data.favorites) {
      expect(item.target).not.toBeNull();
      expect(item.missing_target).toBeUndefined();
      expect(item.target.id).toBe(item.target_id);
    }
    const race = list.body.data.grouped.races[0].target;
    expect(race).toHaveProperty('candidate_count');
    expect(race).toHaveProperty('open_callouts');
  });

  it('rejects favorites for nonexistent targets and duplicates', async () => {
    const user = await registerUser('edge');

    const missing = await post('/api/favorites', { favorite_type: 'race', target_id: 'race-does-not-exist' }, user.token);
    expect(missing.status).toBe(404);

    const first = await post('/api/favorites', { favorite_type: 'race', target_id: raceId }, user.token);
    expect(first.status).toBe(200);
    const dup = await post('/api/favorites', { favorite_type: 'race', target_id: raceId }, user.token);
    expect(dup.status).toBe(409);
  });

  it('requires authentication for favorites and watchlist', async () => {
    expect((await get('/api/favorites')).status).toBe(401);
    expect((await post('/api/favorites', { favorite_type: 'race', target_id: raceId })).status).toBe(401);
    expect((await get('/api/notifications/watchlist')).status).toBe(401);
  });

  it('flags saved items whose target has since disappeared', async () => {
    const user = await registerUser('gone');

    // Create a throwaway race, favorite it, then delete it out from under the favorite
    const goneRaceId = `race-saved-test-${Date.now().toString(36)}`;
    await env.ARENA_DB.prepare(
      `INSERT INTO races (id, name, office, state, status) VALUES (?, 'Vanishing Race', 'House', 'ZZ', 'active')`
    ).bind(goneRaceId).run();

    const fav = await post('/api/favorites', { favorite_type: 'race', target_id: goneRaceId }, user.token);
    expect(fav.status).toBe(200);

    await env.ARENA_DB.prepare(`DELETE FROM races WHERE id = ?`).bind(goneRaceId).run();

    const list = await get('/api/favorites', user.token);
    expect(list.status).toBe(200);
    const item = list.body.data.favorites.find(f => f.target_id === goneRaceId);
    expect(item.target).toBeNull();
    expect(item.missing_target).toBe(true);
  });

  it('removes a favorite by id', async () => {
    const user = await registerUser('remove');
    const created = await post('/api/favorites', { favorite_type: 'candidate', target_id: candidateId }, user.token);
    expect(created.status).toBe(200);

    const removed = await del(`/api/favorites/${created.body.data.id}`, user.token);
    expect(removed.status).toBe(200);

    const list = await get('/api/favorites', user.token);
    expect(list.body.data.favorites).toHaveLength(0);
  });

  it('enriches the notification watchlist with parsed notify_on arrays', async () => {
    const user = await registerUser('watch');

    const sub = await post('/api/notifications/subscribe', {
      subscription_type: 'challenge',
      target_id: challengeId,
      notify_on: ['challenge_responded'],
      channel: 'in_app',
    }, user.token);
    expect(sub.status).toBe(200);

    const watchlist = await get('/api/notifications/watchlist', user.token);
    expect(watchlist.status).toBe(200);
    expect(watchlist.body.data.subscriptions).toHaveLength(1);
    const item = watchlist.body.data.subscriptions[0];
    expect(item.notify_on).toEqual(['challenge_responded']);
    expect(item.target).not.toBeNull();
    expect(item.target.id).toBe(challengeId);
    expect(watchlist.body.data.grouped.challenges).toHaveLength(1);
  });
});
