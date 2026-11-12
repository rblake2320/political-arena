import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { r2MediaResponse } from '../src/media.js';
import worker from '../src/worker.js';

describe('media HTTP contract', () => {
  const key = `uploads/http-${crypto.randomUUID()}/fixture.mp4`;
  const url = `https://example.com/media/${key}`;
  beforeAll(async () => {
    await SELF.fetch('https://example.com/api/health');
    await env.ARENA_MEDIA.put(key, '0123456789', { httpMetadata: { contentType: 'video/mp4' } });
  });

  it('HEAD returns the full metadata and no body, ignoring Range', async () => {
    const res = await r2MediaResponse(env.ARENA_MEDIA, key, new Request(url, { method: 'HEAD', headers: { Range: 'bytes=2-4' } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Length')).toBe('10');
    expect(res.headers.get('ETag')).toBeTruthy();
    expect(res.headers.get('Last-Modified')).toBeTruthy();
    expect(await res.text()).toBe('');
  });

  it('matching If-None-Match returns 304 without a body', async () => {
    const head = await env.ARENA_MEDIA.head(key);
    const res = await SELF.fetch(url, { headers: { 'If-None-Match': `"other", W/${head.httpEtag}` } });
    expect(res.status).toBe(304);
    expect(await res.text()).toBe('');
    expect(res.headers.get('ETag')).toBe(head.httpEtag);
  });

  it('a stale If-Range serves the whole current object', async () => {
    const res = await SELF.fetch(url, { headers: { Range: 'bytes=2-4', 'If-Range': '"old-version"' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('0123456789');
  });

  it('a matching If-Range serves the requested bytes', async () => {
    const head = await env.ARENA_MEDIA.head(key);
    const res = await SELF.fetch(url, { headers: { Range: 'bytes=2-4', 'If-Range': head.httpEtag } });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 2-4/10');
    expect(await res.text()).toBe('234');
  });

  it('missing media carries the same security headers as successful media', async () => {
    const res = await SELF.fetch('https://example.com/media/uploads/missing.mp4');
    expect(res.status).toBe(404);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('contains R2 outages in a 503 response', async () => {
    const res = await worker.fetch(new Request(url), { ...env, ARENA_MEDIA: { head: async () => { throw new Error('R2 unavailable'); } } }, { waitUntil: () => {} });
    expect(res.status).toBe(503);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('detects an object replacement between metadata and content reads', async () => {
    const raceKey = `uploads/race-${crypto.randomUUID()}.mp4`;
    await env.ARENA_MEDIA.put(raceKey, 'old');
    const bucket = {
      head: key => env.ARENA_MEDIA.head(key),
      get: async (key, options) => {
        await env.ARENA_MEDIA.put(key, 'new-and-longer');
        return env.ARENA_MEDIA.get(key, options);
      },
    };
    const res = await r2MediaResponse(bucket, raceKey, new Request(`https://example.com/media/${raceKey}`));
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('1');
    expect(await res.text()).toBe('');
  });

  it('uses Last-Modified only when If-None-Match is absent', async () => {
    const head = await env.ARENA_MEDIA.head(key);
    const date = head.uploaded.toUTCString();
    expect((await SELF.fetch(url, { headers: { 'If-Modified-Since': date } })).status).toBe(304);
    const changedTag = await SELF.fetch(url, { headers: { 'If-Modified-Since': date, 'If-None-Match': '"old"' } });
    expect(changedTag.status).toBe(200);
    expect(await changedTag.text()).toBe('0123456789');
  });

  it.each(['bytes=10-', 'bytes=4-2', 'bytes=-0', 'bytes=0-1,3-4'])('rejects an unsatisfiable single range %s', async Range => {
    const res = await SELF.fetch(url, { headers: { Range } });
    expect(res.status).toBe(416);
    expect(res.headers.get('Content-Range')).toBe('bytes */10');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('does not serve media to unsupported methods', async () => {
    const res = await SELF.fetch(url, { method: 'POST' });
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET, HEAD');
  });
});
