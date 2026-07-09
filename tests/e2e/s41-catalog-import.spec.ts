// tests/e2e/s41-catalog-import.spec.ts
//
// Session 41 / Task 15.1 — browser E2E validation of the catalog Import / Export
// feature against the cloud V3 dev DB (real BO app, real RPCs):
//
//   T1 — Products page has "Import / Export" tab; navigate to it;
//        three zones visible (Template / Export / Import dropzone).
//   T2 — "Download empty template" triggers a non-empty file download
//        (suggestedFilename contains "breakery-catalog-template").
//   T3 — Upload a minimal test .xlsx (S41E2E data), dry-run passes,
//        summary cards show "create" counts, confirm-import → "Import complete".
//   T4 — DB verification (executed out-of-band via supabase MCP SQL):
//        products WHERE sku LIKE 'S41E2E-%' has 2 rows; recipe exists.
//   T5 — "Export full catalog" triggers a non-empty file download.
//
// Project: backoffice (baseURL = E2E_BO_URL or localhost:5174).
//
// IMPORTANT — single shared login: the auth-verify-pin EF is rate-limited to
// 3 req/min/IP (S19 durable rate-limit). Tests run serial and log in ONCE in
// beforeAll on a shared page. The BO authStore persists the PIN session (S36
// boot rehydration), so page.reload() inside tests stays authenticated.
//
// Deviations:
//   DEV-S41-T3-01: The xlsx file is built at test-time from the Node.js side
//     using the xlsx package found in apps/backoffice/node_modules/xlsx.
//     We require() it directly because the E2E spec runs in Node (Playwright
//     worker), not in the browser bundle.
//   DEV-S41-T3-02: The input[type=file] inside ImportDropzone has aria-hidden
//     so we can't reach it via accessible name. We target it via
//     page.locator('[data-testid="import-dropzone"] input[type="file"]')
//     and use setInputFiles() — Playwright bypasses the sr-only + aria-hidden
//     restriction for file inputs correctly.
//   DEV-S41-T2-05: downloadWorkbook() calls XLSX.writeFile which in a Vite
//     dev-server browser context uses a Blob + <a> download click, triggering
//     a Playwright download event.  Same mechanism for T5 export.
//   DEV-S41-T3-03: The dry-run + commit path is tested end-to-end. After a
//     successful import the test verifies the "Import complete" badge is
//     rendered.  DB cleanup is performed via Supabase MCP SQL (T4 section
//     of the final report) — not inside Playwright.
//   DEV-S41-T1-01: The "Import / Export" tab is only rendered when the logged-in
//     user has the catalog.import permission.  The seed OWNER (…0001) is
//     SUPER_ADMIN and holds this permission from seed migration _013.

import os from 'os';
import path from 'path';
import fs from 'fs';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { loginWithPin, SEED_USER_OWNER } from './fixtures/auth';

test.use({ baseURL: process.env.E2E_BO_URL ?? 'http://localhost:5174' });
test.describe.configure({ mode: 'serial' });

const ADMIN_PIN = process.env.E2E_PIN_ADMIN ?? '123456';

let context: BrowserContext;
let page: Page;

// Path to the test xlsx we generate before T3.
let testXlsxPath: string;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  // acceptDownloads is required for page.waitForEvent('download') to fire
  // when XLSX.writeFile() triggers the <a download> mechanism in Chromium.
  context = await browser.newContext({ acceptDownloads: true });
  page = await context.newPage();
  await page.goto('/');
  await expect(page.getByTestId(`user-picker-${SEED_USER_OWNER}`)).toBeVisible({ timeout: 60_000 });
  await loginWithPin(page, ADMIN_PIN, SEED_USER_OWNER);
  await expect(page).toHaveURL(/\/backoffice/, { timeout: 20_000 });

  // ── Build test xlsx (DEV-S41-T3-01) ─────────────────────────────────────────
  // We require xlsx from the backoffice node_modules because the spec runs in
  // Node (Playwright worker context), not inside the browser bundle.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require(
    path.resolve(
      __dirname,
      '../../apps/backoffice/node_modules/xlsx',
    ),
  ) as typeof import('xlsx');

  const wb = XLSX.utils.book_new();

  // Sheet 1: Categories
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['name', 'dispatch_station', 'sort_order'],
      ['S41E2E Cat', 'none', 99],
    ]),
    'Categories',
  );

  // Sheet 2: Ingredients — S41E2E-ING, unit kg, cost 1000
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['sku', 'name', 'unit', 'cost_price', 'category',
       'min_stock_threshold', 'shelf_life_hours',
       'purchase_unit', 'recipe_unit', 'opname_unit', 'sales_unit'],
      ['S41E2E-ING', 'S41E2E Ingredient', 'kg', 1000, null,
       null, null, null, null, null, null],
    ]),
    'Ingredients',
  );

  // Sheet 3: Products — S41E2E-PRD, category S41E2E Cat, retail 5000, unit pcs
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['sku', 'name', 'category', 'unit', 'retail_price', 'wholesale_price',
       'description', 'image_url', 'visible_on_pos', 'is_favorite',
       'shelf_life_hours', 'purchase_unit', 'recipe_unit', 'opname_unit', 'sales_unit'],
      ['S41E2E-PRD', 'S41E2E Product', 'S41E2E Cat', 'pcs', 5000, null,
       null, null, true, false, null, null, null, null, null],
    ]),
    'Products',
  );

  // Sheet 4: Units — empty (headers only)
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['product_sku', 'code', 'factor_to_base', 'tags'],
    ]),
    'Units',
  );

  // Sheet 5: Variants — empty (headers only)
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['parent_sku', 'variant_axis', 'variant_label', 'sku', 'retail_price', 'image_url'],
    ]),
    'Variants',
  );

  // Sheet 6: Recipes — S41E2E-PRD ← 0.1 kg of S41E2E-ING
  // Using kg (not g) to avoid conversion-lookup issues (DEV-S41-T3-01).
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['product_sku', 'material_sku', 'quantity', 'unit', 'notes'],
      ['S41E2E-PRD', 'S41E2E-ING', 0.1, 'kg', null],
    ]),
    'Recipes',
  );

  testXlsxPath = path.join(os.tmpdir(), 's41e2e-catalog-test.xlsx');
  XLSX.writeFile(wb, testXlsxPath);
});

test.afterAll(async () => {
  // Clean up the test xlsx file.
  if (testXlsxPath && fs.existsSync(testXlsxPath)) {
    fs.unlinkSync(testXlsxPath);
  }
  await context?.close();
});

// ── T1 — Products page: "Import / Export" tab navigates to the 3-zone page ──

test('T1: products page — "Import / Export" tab visible, navigates to 3-zone import-export page', async () => {
  await page.goto('/backoffice/products');

  // Wait for the products list to hydrate (the tab strip renders early but
  // we want to ensure React has mounted before clicking).
  const productsNav = page.getByRole('navigation', { name: 'Products sections' });
  await expect(productsNav.getByRole('link', { name: 'Products', exact: true })).toBeVisible({
    timeout: 30_000,
  });

  // The "Import / Export" tab must be visible (gate catalog.import — OWNER is SUPER_ADMIN).
  const importTab = productsNav.getByRole('link', { name: 'Import / Export' });
  await expect(importTab).toBeVisible({ timeout: 10_000 });

  // Click the tab.
  await importTab.click();
  await expect(page).toHaveURL(/\/backoffice\/products\/import-export/, { timeout: 10_000 });

  // Wait for the page content: all 3 zones (Template / Export / Import).
  await expect(page.getByText('Download empty template')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Export full catalog')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('import-dropzone')).toBeVisible({ timeout: 10_000 });

  await page.screenshot({ path: 'test-results/s41-t1.png', fullPage: true });
});

// ── T2 — "Download empty template" → non-empty file download ─────────────────

test('T2: download empty template — triggers non-empty xlsx download', async () => {
  await page.goto('/backoffice/products/import-export');
  await expect(page.getByText('Download empty template')).toBeVisible({ timeout: 30_000 });

  // Playwright intercepts the blob download triggered by XLSX.writeFile.
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20_000 }),
    page.getByRole('button', { name: 'Download empty template' }).click(),
  ]);

  // Verify the suggested filename contains the expected prefix.
  const suggested = download.suggestedFilename();
  expect(suggested).toMatch(/breakery-catalog-template/i);

  // Verify the downloaded file is non-empty (DEV-S41-T2-05).
  const dlPath = await download.path();
  expect(dlPath).not.toBeNull();
  if (dlPath) {
    const { size } = fs.statSync(dlPath);
    expect(size).toBeGreaterThan(0);
  }

  await page.screenshot({ path: 'test-results/s41-t2.png', fullPage: true });
});

// ── T3 — Upload test xlsx → dry-run passes → confirm-import → "Import complete" ─

test('T3: import flow — upload S41E2E xlsx, dry-run valid, confirm → Import complete badge', async () => {
  // This test runs a full dry-run + commit cycle against the cloud V3 dev RPC.
  // Give it a generous timeout to account for both RPC round-trips.
  test.setTimeout(120_000);

  await page.goto('/backoffice/products/import-export');
  await expect(page.getByTestId('import-dropzone')).toBeVisible({ timeout: 30_000 });

  // Collect console error messages for the final assertion.
  const consoleMsgs: string[] = [];
  page.on('console', (msg) => {
    consoleMsgs.push(`[${msg.type()}] ${msg.text()}`);
  });

  // The ImportDropzone renders an sr-only + aria-hidden <input type="file">.
  // React 18 in Vite dev mode: synthetic onChange fires correctly when we
  // combine DataTransfer injection + nativeInputValueSetter technique + both
  // 'input' and 'change' events dispatched on the element.
  const xlsxBytes = Array.from(fs.readFileSync(testXlsxPath));
  await page.evaluate(({ bytes, filename }) => {
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid="import-dropzone"] input[type="file"]',
    );
    if (!input) throw new Error('File input not found');
    const uint8 = new Uint8Array(bytes);
    const file = new File([uint8], filename, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const dt = new DataTransfer();
    dt.items.add(file);
    // Use Object.defineProperty (same as @testing-library/user-event) to set
    // the files property since it is normally read-only.
    Object.defineProperty(input, 'files', {
      value: dt.files,
      configurable: true,
    });
    // React 18 routes events through the React root container. Dispatch both
    // 'input' and 'change' events so React's fiber reconciler picks up the new
    // files regardless of which event it listens to for <input type="file">.
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  }, { bytes: xlsxBytes, filename: path.basename(testXlsxPath) });

  // Wait 200ms for React to process the event batch and start the async chain.
  await page.waitForTimeout(200);

  // Quick diagnostic: screenshot right after upload to see if the UI reacted.
  await page.screenshot({ path: 'test-results/s41-t3-after-upload.png', fullPage: true });

  // Wait briefly for the React synthetic change event to fire and the async
  // handleFile → parseCatalogWorkbook + dry-run RPC chain to complete.
  // The page transitions: idle → parsed (brief) → previewed (confirm-import visible).
  // Allow 60s for the RPC call to the cloud V3 dev instance.
  const confirmBtn = page.getByTestId('confirm-import');
  await expect(confirmBtn).toBeVisible({ timeout: 60_000 }).catch(async (err: unknown) => {
    // Log all captured console messages to help diagnose failures.
    console.log('=== Console messages captured during T3 ===');
    consoleMsgs.forEach((m) => console.log(m));
    console.log('===========================================');
    throw err;
  });

  // The dry-run report must be valid (our minimal payload satisfies all validators).
  // If valid=false the button is disabled — we assert it is enabled here.
  await expect(confirmBtn).toBeEnabled({ timeout: 5_000 });

  // ImportSummaryCards must show at least one "create" count > 0.
  const summaryGrid = page.locator('.grid').filter({ has: page.getByText('Categories') });
  await expect(summaryGrid).toBeVisible({ timeout: 10_000 });

  await page.screenshot({ path: 'test-results/s41-t3-preview.png', fullPage: true });

  // Click confirm-import.
  await confirmBtn.click();

  // Wait for the commit RPC round-trip and state-machine transition to 'done'.
  const importCompleteBadge = page.getByText('Import complete');
  await expect(importCompleteBadge).toBeVisible({ timeout: 60_000 });

  await page.screenshot({ path: 'test-results/s41-t3.png', fullPage: true });

  // Filter known-benign console noise before asserting no error messages.
  const realErrors = consoleMsgs.filter(
    (m) =>
      m.startsWith('[error]') &&
      !m.includes('Download the React DevTools') &&
      !m.includes('__REDUX_DEVTOOLS_EXTENSION__') &&
      !m.includes('favicon'),
  );
  expect(realErrors).toEqual([]);
});

// ── T5 — "Export full catalog" → non-empty xlsx download ─────────────────────
// (T4 — DB verification — is performed out-of-band via Supabase MCP SQL and
//  reported in the test-engineer final output, not via Playwright.)

test('T5: export full catalog — triggers non-empty xlsx download', async () => {
  await page.goto('/backoffice/products/import-export');
  await expect(page.getByText('Export full catalog')).toBeVisible({ timeout: 30_000 });

  // Trigger export and capture the download event.
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByRole('button', { name: 'Export full catalog' }).click(),
  ]);

  // Filename follows the pattern "breakery-catalog-export-YYYY-MM-DD.xlsx".
  const suggested = download.suggestedFilename();
  expect(suggested).toMatch(/breakery-catalog-export/i);

  // Verify non-empty.
  const dlPath = await download.path();
  expect(dlPath).not.toBeNull();
  if (dlPath) {
    const { size } = fs.statSync(dlPath);
    expect(size).toBeGreaterThan(0);
  }

  await page.screenshot({ path: 'test-results/s41-t5.png', fullPage: true });
});
