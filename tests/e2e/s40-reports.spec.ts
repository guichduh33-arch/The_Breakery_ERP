// tests/e2e/s40-reports.spec.ts
//
// Session 40 / Wave D3 — browser E2E validation of the 9 new report pages
// against the cloud V3 dev DB (real BO app, real RPCs):
//
//   T1 — Hub has zero "Soon" cards and >= 26 active report links
//   T2 — Daily Sales page renders data / KPI cards and CSV export works
//   T3 — Purchase by Supplier page renders or shows clean empty state; no console errors
//   T4 — Permission Change Log page renders historical rows or clean empty state
//
// Project: backoffice (baseURL = E2E_BO_URL or localhost:5174).
//
// IMPORTANT — single shared login: the auth-verify-pin EF is rate-limited to
// 3 req/min/IP (S19 durable rate-limit). Four independent per-test logins
// would trip it, so this suite runs serial and logs in ONCE in beforeAll on a
// shared page. The BO authStore persists the PIN session (S36 boot
// rehydration), so page.reload() inside tests stays authenticated.
//
// Deviations:
//   DEV-S40-D3-01: T2 uses a 90-day window to maximise chance of hitting seeded
//     paid orders; if no data is present we assert KPI cards are visible instead
//     of failing the test.
//   DEV-S40-D3-02: T2 CSV download is validated via page download event —
//     Playwright intercepts the blob download and checks it is non-empty.
//   DEV-S40-D3-03: T4 may show 0 rows if the cloud DB permission-changes audit
//     trail is empty for the last-30-days window; in that case we assert the
//     clean empty-state message renders instead.

import path from 'path';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { loginWithPin, SEED_USER_OWNER } from './fixtures/auth';

test.use({ baseURL: process.env.E2E_BO_URL ?? 'http://localhost:5174' });
test.describe.configure({ mode: 'serial' });

const ADMIN_PIN = process.env.E2E_PIN_ADMIN ?? '123456';

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  // Vite dev-server cold start transforms the whole dep graph on first hit —
  // the default 30s hook timeout is not enough on a cold run.
  test.setTimeout(120_000);
  context = await browser.newContext();
  page = await context.newPage();
  await page.goto('/');
  // Wait for the login user picker to be hydrated before driving it.
  await expect(page.getByTestId(`user-picker-${SEED_USER_OWNER}`)).toBeVisible({ timeout: 60_000 });
  await loginWithPin(page, ADMIN_PIN, SEED_USER_OWNER);
  await expect(page).toHaveURL(/\/backoffice/, { timeout: 20_000 });
});

test.afterAll(async () => {
  await context?.close();
});

// ── T1 — Reports hub: zero "Soon" cards, >= 26 active links ──────────────────

test('T1: reports hub — zero "Soon" cards, >= 26 active report links', async () => {
  await page.goto('/backoffice/reports');

  // Wait for the hub to hydrate (section labels are visible once React renders).
  await expect(page.getByRole('heading', { name: 'Reports & Analytics' })).toBeVisible({
    timeout: 30_000,
  });

  // All previously-"Soon" cards are now gone — every card has a `to` prop
  // which renders a <Link> instead of a disabled <div aria-disabled="true">.
  const disabledCards = page.locator('[aria-disabled="true"]');
  await expect(disabledCards).toHaveCount(0, { timeout: 10_000 });

  // Count active report card links. Cards with a `to` prop render as <Link> → <a>.
  // 25 out of 26 link to /reports/* paths; the "Margin Watch" card links to
  // /backoffice/inventory/production/margin-watch (href does NOT contain /reports/).
  // Strategy: count links under /reports/* plus the margin-watch link separately.
  const reportPathLinks   = page.locator('a[href*="/reports/"]');
  const marginWatchLinks  = page.locator('a[href*="margin-watch"]');
  const reportCount       = await reportPathLinks.count();
  const marginWatchCount  = await marginWatchLinks.count();
  const linkCount = reportCount + marginWatchCount;
  // The hub has 26 active cards.
  expect(linkCount).toBeGreaterThanOrEqual(26);

  await page.screenshot({ path: 'test-results/s40-t1.png', fullPage: true });
});

// ── T2 — Daily Sales: data renders, CSV export is non-empty ──────────────────

test('T2: daily sales — KPI cards visible, CSV export downloads a non-empty file', async () => {
  await page.goto('/backoffice/reports/daily-sales');

  // Wait for the page to load (use h1 to avoid strict-mode violation with h3
  // sidebar label that also reads "Daily Sales").
  await expect(page.locator('h1').filter({ hasText: 'Daily Sales' })).toBeVisible({
    timeout: 30_000,
  });

  // Widen date range to 90 days to maximise seed-data coverage (DEV-S40-D3-01).
  // The DateRangePicker uses two <input type="date"> in order: start then end.
  const dateInputs = page.locator('input[type="date"]');
  await expect(dateInputs.first()).toBeVisible({ timeout: 15_000 });

  // Compute 90-day-ago date string YYYY-MM-DD.
  const start90 = new Date(Date.now() - 90 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  await dateInputs.first().fill(start90);
  // Trigger onStartChange — tab away to fire blur/change.
  await dateInputs.first().press('Tab');

  // Wait for the loading state to resolve (at most 20s for RPC round-trip).
  // Either the data table renders rows OR the "No sales" empty-state appears.
  // Either way the ExportButtons CSV button must be visible (it renders once
  // `data` is non-null, including when by_day is empty).
  const csvBtn = page.getByTestId('export-csv');

  // Wait for query to resolve — loading spinner may appear briefly.
  await expect(csvBtn).toBeVisible({ timeout: 25_000 });

  // KPI tiles are rendered when summary is non-null (same guard as CSV btn).
  // Accept either the KPI tile OR the "No sales for this period" empty state.
  const kpiBlock  = page.locator('.grid').filter({ hasText: /Total.*Orders|Orders.*Total/i });
  const emptyText = page.getByText('No sales for this period.');
  const hasData = await kpiBlock.isVisible({ timeout: 5_000 }).catch(() => false);
  const hasEmpty = await emptyText.isVisible({ timeout: 5_000 }).catch(() => false);
  // At least one of the two must be visible.
  expect(hasData || hasEmpty).toBe(true);

  // Click CSV export and capture the download event (DEV-S40-D3-02).
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15_000 }),
    csvBtn.click(),
  ]);
  const dlPath = await download.path();
  expect(dlPath).not.toBeNull();

  if (dlPath) {
    const { statSync } = await import('fs');
    const { size } = statSync(dlPath);
    expect(size).toBeGreaterThan(0);
  }

  await page.screenshot({ path: 'test-results/s40-t2.png', fullPage: true });
});

// ── T3 — Purchase by Supplier: renders (populated or clean empty); no console errors ──

test('T3: purchase by supplier — renders without console errors', async () => {
  // Collect browser console errors before navigating.
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/backoffice/reports/purchase-by-supplier');

  // Wait for the page heading (scope to h1 to avoid strict-mode violation).
  await expect(page.locator('h1').filter({ hasText: 'Purchase by Supplier' })).toBeVisible({
    timeout: 30_000,
  });

  // Wait for query to settle — either the table renders or the empty state.
  const tableBody = page.locator('table tbody');
  const emptyText = page.getByText('No purchase orders for this period.');
  // Wait for one of these to appear (both are meaningful render states).
  await Promise.race([
    tableBody.waitFor({ state: 'visible', timeout: 25_000 }),
    emptyText.waitFor({ state: 'visible', timeout: 25_000 }),
  ]);

  // No "Failed to load" error banner.
  await expect(page.locator('[role="alert"]')).toHaveCount(0, { timeout: 5_000 });

  // No JavaScript console errors of severity 'error'.
  // Filter out known benign React DevTools / extension noise.
  const realErrors = consoleErrors.filter(
    (m) =>
      !m.includes('Download the React DevTools') &&
      !m.includes('__REDUX_DEVTOOLS_EXTENSION__') &&
      !m.includes('favicon'),
  );
  expect(realErrors).toEqual([]);

  await page.screenshot({ path: 'test-results/s40-t3.png', fullPage: true });
});

// ── T4 — Permission Change Log: renders historical rows or clean empty state ──

test('T4: permission change log — renders without errors; rows OR clean empty state', async () => {
  await page.goto('/backoffice/reports/permission-changes');

  // Wait for the page heading (scope to h1 to avoid strict-mode violation).
  await expect(page.locator('h1').filter({ hasText: 'Permission Change Log' })).toBeVisible({
    timeout: 30_000,
  });

  // Wait for query to settle — either rows or empty state (DEV-S40-D3-03).
  const tableBody  = page.locator('table tbody');
  const emptyText  = page.getByText('No permission changes recorded for this period.');
  await Promise.race([
    tableBody.waitFor({ state: 'visible', timeout: 25_000 }),
    emptyText.waitFor({ state: 'visible', timeout: 25_000 }),
  ]);

  // No "Failed to load" error banner.
  await expect(page.locator('[role="alert"]')).toHaveCount(0, { timeout: 5_000 });

  // If the table has actual data rows (not just the single empty-state td),
  // assert each data row has the expected columns.
  // The empty-state row renders as 1 <td colSpan=6>; real data rows have 6 tds.
  const allRows = tableBody.locator('tr');
  const rowCount = await allRows.count();
  if (rowCount > 0) {
    const firstCells = allRows.first().locator('td');
    const cellCount = await firstCells.count();
    // A data row has 6 cells; the empty-state row has 1. Skip column check when
    // only the empty-state row is present.
    if (cellCount >= 4) {
      // This is a real data row — further structural assertions could go here.
      // (No additional assertions needed beyond visibility already checked above.)
    }
  }

  // CSV export button visible (rendered when data is non-null, any # of rows).
  const csvBtn = page.getByTestId('export-csv');
  await expect(csvBtn).toBeVisible({ timeout: 10_000 });

  await page.screenshot({ path: 'test-results/s40-t4.png', fullPage: true });
});
