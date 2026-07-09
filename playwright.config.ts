// playwright.config.ts
//
// Session 13 / Phase 6.C — Playwright config for cross-app E2E.
// Session 21 — pos + backoffice named projects, E2E_POS_URL / E2E_BO_URL.
// Session 71 — webServer build+preview in-CI (dev V3 backend), s44 wired.
//
// CI: the job builds + serves both apps on localhost via `webServer` below,
// with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY pointing at the dev V3
// project. `pnpm exec playwright test --list` works without any server.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // E2E specs may share dev DB state — run serially.
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
  webServer: [
    {
      command:
        'pnpm --filter @breakery/app-pos build && pnpm --filter @breakery/app-pos preview --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command:
        'pnpm --filter @breakery/app-backoffice build && pnpm --filter @breakery/app-backoffice preview --port 5174 --strictPort',
      url: 'http://localhost:5174',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
  projects: [
    {
      name: 'pos',
      testMatch: /(complete-order|pos-login-order|s43-pos-audit-fixes|s44-money-path)\.spec\.ts$/,
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
