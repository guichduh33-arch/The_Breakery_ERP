// tests/e2e/stock-inventory-pages.spec.ts
//
// Audit 2026-06-12 / Task D3 — regression guard for the 4 pages killed by C1
// (unbound supabase.rpc → "Cannot read properties of undefined (reading 'rest')"):
//
//   T1 — /inventory/movements : feed table loads, no "Failed to load" alert
//   T2 — /inventory/alerts    : page renders, Status tile is NOT 'Unavailable'
//   T3 — /inventory/opname    : New count → section → Create → detail page,
//                               then Cancel so the dev DB is not polluted
//   T4 — /products/:id/dashboard : product title renders, no error alert
//
// Every test also fails if the browser console logs the C1 signature
// "reading 'rest'".
//
// Single shared login (auth-verify-pin is rate-limited 3/min/IP — see
// s40-reports.spec.ts for the precedent).

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { loginWithPin, SEED_USER_OWNER } from './fixtures/auth';

test.use({ baseURL: process.env.E2E_BO_URL ?? 'http://localhost:5174' });
test.describe.configure({ mode: 'serial' });

const ADMIN_PIN = process.env.E2E_PIN_ADMIN ?? '123456';

let context: BrowserContext;
let page: Page;
let consoleErrors: string[] = [];

function assertNoC1Signature(): void {
  const c1 = consoleErrors.filter((m) => m.includes("reading 'rest'"));
  expect(c1).toEqual([]);
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  context = await browser.newContext();
  page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  await page.goto('/');
  await expect(page.getByTestId(`user-picker-${SEED_USER_OWNER}`)).toBeVisible({ timeout: 60_000 });
  await loginWithPin(page, ADMIN_PIN, SEED_USER_OWNER);
  await expect(page).toHaveURL(/\/backoffice/, { timeout: 20_000 });
});

test.afterAll(async () => {
  await context?.close();
});

test.beforeEach(() => {
  consoleErrors = [];
});

// ── T1 — Live Movements feed loads ───────────────────────────────────────────

test('T1: stock movements — feed table loads without errors', async () => {
  await page.goto('/backoffice/inventory/movements');
  await expect(page.locator('h1').filter({ hasText: 'Stock movements' })).toBeVisible({
    timeout: 30_000,
  });

  // The feed table (or its clean empty state) must render — wait for the
  // query to settle, then assert there is no "Failed to load" alert.
  const tableBody = page.locator('table tbody');
  const emptyText = page.getByText(/no movements/i);
  await Promise.race([
    tableBody.waitFor({ state: 'visible', timeout: 25_000 }),
    emptyText.waitFor({ state: 'visible', timeout: 25_000 }),
  ]);
  await expect(page.getByText(/failed to load/i)).toHaveCount(0);
  assertNoC1Signature();

  await page.screenshot({ path: 'test-results/stock-d3-t1.png', fullPage: true });
});

// ── T2 — Alerts page renders, Status is honest ───────────────────────────────

test('T2: inventory alerts — renders, Status tile is not "Unavailable"', async () => {
  await page.goto('/backoffice/inventory/alerts');
  await expect(page.locator('h1').filter({ hasText: 'Inventory alerts' })).toBeVisible({
    timeout: 30_000,
  });

  // Post-C1 the low-stock query succeeds → the A4 'Unavailable' state (query
  // error) must NOT show. Either 'All clear' or 'Action needed' is fine.
  await expect(page.getByText('Unavailable')).toHaveCount(0, { timeout: 25_000 });
  const allClear = page.getByText('All clear');
  const action   = page.getByText('Action needed');
  const hasClear  = await allClear.isVisible({ timeout: 15_000 }).catch(() => false);
  const hasAction = await action.isVisible({ timeout: 5_000 }).catch(() => false);
  expect(hasClear || hasAction).toBe(true);
  assertNoC1Signature();

  await page.screenshot({ path: 'test-results/stock-d3-t2.png', fullPage: true });
});

// ── T3 — Opname create → detail → cancel (no residue) ────────────────────────

test('T3: opname — create a count, land on detail, cancel it', async () => {
  test.setTimeout(90_000);
  await page.goto('/backoffice/inventory/opname');
  await expect(page.getByRole('button', { name: /new count/i })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: /new count/i }).click();
  await expect(page.getByText('New stock count')).toBeVisible({ timeout: 10_000 });

  // Pick the first real section in the select (index 0 is the placeholder).
  const sectionSelect = page.locator('#opname-section');
  await sectionSelect.selectOption({ index: 1 });

  await page.getByRole('button', { name: /^create count$/i }).click();

  // useCreateOpname onSuccess navigates to the detail page (post-C1 the RPC
  // call works again — pre-fix this threw "reading 'rest'").
  await expect(page).toHaveURL(/\/inventory\/opname\/[0-9a-f-]{36}/, { timeout: 25_000 });

  // Cancel the count so the dev DB stays clean.
  await page.getByRole('button', { name: /^cancel$/i }).click();
  await expect(page.getByText('Cancel stock count')).toBeVisible({ timeout: 10_000 });
  await page.locator('#opname-cancel-reason').fill('E2E regression test cleanup (audit D3)');
  await page.getByRole('button', { name: /cancel count/i }).click();

  // The detail page reflects the cancelled status.
  await expect(page.getByText(/cancelled/i).first()).toBeVisible({ timeout: 20_000 });
  assertNoC1Signature();

  await page.screenshot({ path: 'test-results/stock-d3-t3.png', fullPage: true });
});

// ── T4 — Product dashboard renders ───────────────────────────────────────────

test('T4: product dashboard — title renders, no error alert', async () => {
  // Grab a real product id by clicking the first row of the products table
  // (rows navigate via onClick — there are no <a> hrefs to harvest).
  await page.goto('/backoffice/products');
  const firstRow = page.locator('[data-testid="products-table"] tbody tr').first();
  await expect(firstRow).toBeVisible({ timeout: 30_000 });
  await firstRow.click();
  await expect(page).toHaveURL(/\/backoffice\/products\/[0-9a-f-]{36}/, { timeout: 20_000 });
  const match = page.url().match(/\/backoffice\/products\/([0-9a-f-]{36})/);
  expect(match).not.toBeNull();

  await page.goto(`/backoffice/products/${match![1]}/dashboard`);

  // The dashboard h1 is the product name — assert a non-empty h1 renders and
  // the page shows no error alert (pre-C1 this page died on "reading 'rest'").
  const h1 = page.locator('h1');
  await expect(h1.first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/failed to load/i)).toHaveCount(0);
  assertNoC1Signature();

  await page.screenshot({ path: 'test-results/stock-d3-t4.png', fullPage: true });
});
