import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Integration tests run the REAL worker inside workerd (Cloudflare's runtime)
// against a real SQLite-backed D1 database. Nothing is mocked.
export default defineConfig({
  plugins: [
    cloudflareTest({
      // One worker, shared storage: the suite exercises stateful flows
      // (register -> login -> act) in order, like a real client session.
      singleWorker: true,
      isolatedStorage: false,
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          ENVIRONMENT: 'test',
          JWT_SECRET: 'integration-test-secret-not-used-in-production',
          CHALLENGE_SLA_HOURS: '72',
          REBUTTAL_WINDOW_HOURS: '48',
          MAX_CHALLENGES_PER_DAY: '3',
          MAX_CHALLENGES_PER_WEEK: '10',
          CHALLENGE_COOLDOWN_HOURS: '24',
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.js'],
  },
});
