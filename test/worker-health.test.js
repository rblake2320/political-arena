import worker from '../src/worker.js';
import { describe, expect, it } from 'vitest';

describe('worker health and bootstrap failure handling', () => {
  it('reports degraded health and blocks API routes when database bootstrap fails', async () => {
    const env = {
      ENVIRONMENT: 'test',
      ARENA_DB: {
        batch: async () => {
          throw new Error('database unavailable');
        },
        prepare: () => {
          throw new Error('database unavailable');
        },
      },
      ASSETS: {
        fetch: async () => new Response('not found', { status: 404 }),
      },
    };
    const ctx = { waitUntil: () => {} };

    const health = await worker.fetch(new Request('https://example.com/api/health'), env, ctx);
    expect(health.status).toBe(503);
    expect(health.headers.get('Strict-Transport-Security')).toContain('max-age=31536000');
    const healthBody = await health.json();
    expect(healthBody.status).toBe('degraded');
    expect(healthBody.database).toBe('error');

    const api = await worker.fetch(new Request('https://example.com/api/users/me'), env, ctx);
    expect(api.status).toBe(503);
    const apiBody = await api.json();
    expect(apiBody.error).toBe('Service unavailable');
  });
});
