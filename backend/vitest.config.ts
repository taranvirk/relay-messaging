import { defineConfig } from 'vitest/config';

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://relay:relay@127.0.0.1:5432/relay_test?schema=public';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/1';
process.env.JWT_SECRET ??= 'test-only-relay-secret-that-is-at-least-32-chars';
process.env.FRONTEND_ORIGIN ??= 'http://localhost:5173';
process.env.LOG_LEVEL ??= 'silent';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
  },
});
