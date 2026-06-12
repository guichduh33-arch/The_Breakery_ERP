// playwright.config.ts
//
// Session 13 / Phase 6.C — Playwright config for cross-app E2E.
// Session 21 / Phase 1.B.1 — extended with pos + backoffice named projects,
//   E2E_POS_URL / E2E_BO_URL env vars (used by nightly GHA workflow), and
//   3 new S21 spec files wired to correct projects.
//
// Local note (D-W6-6C-05 / D-S21-1.B.1): the dev servers (`pnpm dev`) + seeded
// staging DB must be running for `pnpm test:e2e` to succeed end-to-end.
// `pnpm test:e2e -- --list` works without any server.
// CI Linux runners install Chromium + run against staging URLs via secrets.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // E2E specs may share staging DB state — run serially.
  forbidOnly: !!process.env.CI,
  retries: 2,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
  },
  projects: [
    {
      name: 'pos',
      testMatch: /(complete-order|pos-login-order)\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.E2E_POS_URL ?? process.env.E2E_BASE_URL ?? 'http://localhost:5173',
      },
    },
    {
      name: 'backoffice',
      testMatch: /(opname-finalize|po-receive|bo-admin-pin-reset|kiosk-display-realtime|s39-bo-completion|s40-reports|s41-catalog-import|stock-inventory-pages)\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.E2E_BO_URL ?? process.env.E2E_BASE_URL ?? 'http://localhost:5174',
      },
    },
  ],
});
