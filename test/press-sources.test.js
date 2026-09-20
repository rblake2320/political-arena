import { SELF } from 'cloudflare:test';
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
    username: `press_${label}_${seq}`.slice(0, 30),
    password: VALID_PASSWORD,
    display_name: `Press ${label}`,
  });
  expect(res.status).toBe(200);
  return { token: res.body.data.token, id: res.body.data.user.id };
}

describe('press tracked news sources', () => {
  beforeAll(async () => {
    await SELF.fetch(`${BASE}/api/health`);
  });

  it('serves preloaded sources and lets users maintain their own source list', async () => {
    const user = await registerUser('sources');

    const anonymous = await api('GET', '/api/press/sources');
    expect(anonymous.status).toBe(401);

    const initial = await api('GET', '/api/press/sources', undefined, user.token);
    expect(initial.status).toBe(200);
    const defaultUrls = new Set(initial.body.data.sources.filter(source => source.is_default).map(source => source.url));
    expect(defaultUrls).toContain('https://www.newser.com/section/4/politics-news-headlines.html');
    expect(defaultUrls).toContain('https://san.com/politics/');
    expect(defaultUrls).toContain('https://san.com/government-oversight/');
    expect(defaultUrls).toContain('https://www.bbc.com/news/politics');
    expect(defaultUrls).toContain('https://www.aljazeera.com/');

    const created = await api('POST', '/api/press/sources', {
      name: 'Local Statehouse Desk',
      url: 'https://statehouse.example/politics',
      description: 'Local legislative coverage',
    }, user.token);
    expect(created.status).toBe(200);
    expect(created.body.data.source).toMatchObject({
      name: 'Local Statehouse Desk',
      url: 'https://statehouse.example/politics',
      description: 'Local legislative coverage',
      is_default: false,
    });

    const afterCreate = await api('GET', '/api/press/sources', undefined, user.token);
    expect(afterCreate.body.data.sources.some(source => source.id === created.body.data.source.id)).toBe(true);

    const removeDefault = await api('DELETE', '/api/press/sources/press-src-bbc-politics', undefined, user.token);
    expect(removeDefault.status).toBe(403);

    const removed = await api('DELETE', `/api/press/sources/${created.body.data.source.id}`, undefined, user.token);
    expect(removed.status).toBe(200);
    expect(removed.body.data.removed).toBe(true);

    const afterRemove = await api('GET', '/api/press/sources', undefined, user.token);
    expect(afterRemove.body.data.sources.some(source => source.id === created.body.data.source.id)).toBe(false);
  });
  it('isolates private sources, deduplicates normalized URLs, and restores deleted sources', async () => {
    const owner = await registerUser('owner');
    const other = await registerUser('other');
    const input = { name: 'Private source', url: 'https://news.example/politics#first' };
    const first = await api('POST', '/api/press/sources', input, owner.token);
    expect(first.status).toBe(200);
    const id = first.body.data.source.id;
    const duplicate = await api('POST', '/api/press/sources', { ...input, url: 'https://news.example/politics#second' }, owner.token);
    expect(duplicate.body.data.source.id).toBe(id);
    const foreignList = await api('GET', '/api/press/sources', undefined, other.token);
    expect(foreignList.body.data.sources.some(source => source.id === id)).toBe(false);
    expect((await api('DELETE', `/api/press/sources/${id}`, undefined, other.token)).status).toBe(404);
    expect((await api('DELETE', `/api/press/sources/${id}`, undefined, owner.token)).status).toBe(200);
    const restored = await api('POST', '/api/press/sources', input, owner.token);
    expect(restored.body.data.source.id).toBe(id);
    const list = await api('GET', '/api/press/sources', undefined, owner.token);
    expect(list.body.data.sources.filter(source => source.id === id)).toHaveLength(1);
  });

  it('rejects anonymous writes and non-HTTP source URLs', async () => {
    const user = await registerUser('validation');
    const input = { name: 'Unsafe', url: 'javascript:alert(1)' };
    expect((await api('POST', '/api/press/sources', input)).status).toBe(401);
    expect((await api('DELETE', '/api/press/sources/any')).status).toBe(401);
    for (const url of ['javascript:alert(1)', 'file:///private', 'data:text/html,hello', 'not a url']) {
      expect((await api('POST', '/api/press/sources', { ...input, url }, user.token)).status).toBe(400);
    }
  });

});
