import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    // S77 nightly triage — functions/_quarantine/ holds specs that call DROPped
    // RPCs (old money-path versions). Excluded from the run until rewritten in a
    // dedicated session; each file carries a dated OBSOLETE header explaining
    // where live coverage now lives.
    exclude: [...configDefaults.exclude, '**/_quarantine/**'],
    // Integration tests share a single Postgres + a small set of seed users
    // (EMP000, EMP001, EMP002, EMP003). Running test files in parallel triggers
    // races on `pos_sessions` (each beforeAll closes the previous file's open
    // session). Force serial file execution to keep state stable.
    fileParallelism: false,
  },
});
