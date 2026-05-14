// playwright.config.ts
//
// Session 13 / Phase 6.C — Playwright config for cross-app E2E. Projects:
//   - chromium-pos        : POS app at http://localhost:5173
//   - chromium-backoffice : BO app at http://localhost:5174
//
// Local note (D-W6-6C-05): the dev servers (`pnpm dev`) + seeded staging DB
// must be running for `pnpm e2e` to succeed end-to-end. `pnpm e2e --list`
// works without any server. CI Linux runners will boot the dev servers via a
// follow-up workflow.

import { defineConfig, devices } from '@playwright/test';

const POS_BASE_URL = process.env.POS_BASE_URL ?? 'http://localhost:5173';
const BO_BASE_URL  = process.env.BO_BASE_URL  ?? 'http://localhost:5174';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // E2E specs may share staging DB state — run serially.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    actionTimeout: 10_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-pos',
      testMatch: /complete-order\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: POS_BASE_URL,
      },
    },
    {
      name: 'chromium-backoffice',
      testMatch: /(opname-finalize|po-receive)\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: BO_BASE_URL,
      },
    },
  ],
});
