import { SELF, env } from 'cloudflare:test';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { archiveAndPurge } from '../src/archive.js';

describe('durable retention', () => {
  beforeAll(async () => { await SELF.fetch('https://example.com/api/health'); });
  afterEach(() => vi.restoreAllMocks());

  async function insertOld(id) {
    await env.ARENA_DB.prepare("INSERT INTO analytics_events (id, event_type, created_at) VALUES (?, 'retention_regression', datetime('now', '-90 days'))").bind(id).run();
  }
  const options = { table: 'analytics_events', cutoffModifier: '-30 days' };

  it('preserves both exports when two runs start in the same second', async () => {
    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-10-04T12:00:00.000Z');
    const first = `ret-first-${crypto.randomUUID()}`;
    const second = `ret-second-${crypto.randomUUID()}`;
    await insertOld(first);
    await archiveAndPurge(env, options);
    await insertOld(second);
    await archiveAndPurge(env, options);
    const objects = await env.ARENA_MEDIA.list({ prefix: 'archives/analytics_events/2026-10-04T120000' });
    const exports = await Promise.all(objects.objects.map(async o => (await env.ARENA_MEDIA.get(o.key)).text()));
    expect(exports.join('\n')).toContain(first);
    expect(exports.join('\n')).toContain(second);
    expect(objects.objects.length).toBeGreaterThanOrEqual(2);
    expect(await env.ARENA_DB.prepare('SELECT id FROM analytics_events WHERE id IN (?, ?)').bind(first, second).all()).toMatchObject({ results: [] });
  });

  it('retains source rows when R2 refuses the archive write', async () => {
    const id = `ret-denied-${crypto.randomUUID()}`;
    await insertOld(id);
    await expect(archiveAndPurge({ ...env, ARENA_MEDIA: { put: async () => null } }, options)).rejects.toThrow(/archive/i);
    expect(await env.ARENA_DB.prepare('SELECT id FROM analytics_events WHERE id = ?').bind(id).first()).toMatchObject({ id });
    await env.ARENA_DB.prepare('DELETE FROM analytics_events WHERE id = ?').bind(id).run();
  });

  it('retains rows on storage outage and exports them on retry', async () => {
    const id = `ret-outage-${crypto.randomUUID()}`;
    await insertOld(id);
    await expect(archiveAndPurge({ ...env, ARENA_MEDIA: { put: async () => { throw new Error('storage unavailable'); } } }, options)).rejects.toThrow('storage unavailable');
    expect(await env.ARENA_DB.prepare('SELECT id FROM analytics_events WHERE id = ?').bind(id).first()).not.toBeNull();
    const retry = await archiveAndPurge(env, options);
    expect(retry.archived).toBeGreaterThanOrEqual(1);
    expect(await env.ARENA_DB.prepare('SELECT id FROM analytics_events WHERE id = ?').bind(id).first()).toBeNull();
  });

  it('refuses an existing R2 key without overwriting its export or purging rows', async () => {
    const id = `ret-collision-${crypto.randomUUID()}`;
    const existingKey = `archives/collision-${crypto.randomUUID()}.ndjson`;
    await env.ARENA_MEDIA.put(existingKey, 'prior export\n');
    await insertOld(id);
    const bucket = { put: (_key, body, opts) => env.ARENA_MEDIA.put(existingKey, body, opts) };
    await expect(archiveAndPurge({ ...env, ARENA_MEDIA: bucket }, options)).rejects.toThrow(/archive/i);
    expect(await (await env.ARENA_MEDIA.get(existingKey)).text()).toBe('prior export\n');
    expect(await env.ARENA_DB.prepare('SELECT id FROM analytics_events WHERE id = ?').bind(id).first()).not.toBeNull();
    await env.ARENA_DB.prepare('DELETE FROM analytics_events WHERE id = ?').bind(id).run();
  });

  it('does not purge without an archive bucket', async () => {
    const id = `ret-no-bucket-${crypto.randomUUID()}`;
    await insertOld(id);
    expect(await archiveAndPurge({ ...env, ARENA_MEDIA: undefined }, options)).toMatchObject({ archived: 0, purged: 0 });
    expect(await env.ARENA_DB.prepare('SELECT id FROM analytics_events WHERE id = ?').bind(id).first()).not.toBeNull();
    await env.ARENA_DB.prepare('DELETE FROM analytics_events WHERE id = ?').bind(id).run();
  });

  it('preserves the durable export and retries after an interrupted purge', async () => {
    const id = `ret-interrupted-${crypto.randomUUID()}`;
    await insertOld(id);
    const db = {
      prepare: sql => sql.startsWith('DELETE')
        ? { bind: () => ({ run: async () => { throw new Error('purge interrupted'); } }) }
        : env.ARENA_DB.prepare(sql),
    };
    await expect(archiveAndPurge({ ...env, ARENA_DB: db }, options)).rejects.toThrow('purge interrupted');
    expect(await env.ARENA_DB.prepare('SELECT id FROM analytics_events WHERE id = ?').bind(id).first()).not.toBeNull();
    const listing = await env.ARENA_MEDIA.list({ prefix: 'archives/analytics_events/' });
    let savedKey;
    for (const object of listing.objects) {
      if ((await (await env.ARENA_MEDIA.get(object.key)).text()).includes(id)) savedKey = object.key;
    }
    expect(savedKey).toBeTruthy();
    await archiveAndPurge(env, options);
    expect(await env.ARENA_DB.prepare('SELECT id FROM analytics_events WHERE id = ?').bind(id).first()).toBeNull();
    expect(await (await env.ARENA_MEDIA.get(savedKey)).text()).toContain(id);
  });
});
