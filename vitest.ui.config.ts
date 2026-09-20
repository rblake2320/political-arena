import { defineConfig } from 'vitest/config';

// Client-state unit tests; API responses are mocked, unlike the D1 suite.
export default defineConfig({ test: { include: ['test-ui/**/*.test.ts'] } });
