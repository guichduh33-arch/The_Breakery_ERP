import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    // Integration tests share a single Postgres + a small set of seed users
    // (EMP000, EMP001, EMP002, EMP003). Running test files in parallel triggers
    // races on `pos_sessions` (each beforeAll closes the previous file's open
    // session). Force serial file execution to keep state stable.
    fileParallelism: false,
  },
});
