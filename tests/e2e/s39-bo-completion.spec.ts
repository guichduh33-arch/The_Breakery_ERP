// tests/e2e/s39-bo-completion.spec.ts
//
// Session 39 / Wave D3 — browser E2E validation of the 4 S39 BO features
// against the cloud V3 dev DB (real BO app, real RPCs):
//
//   T1 — B2B Settings persistence  (/backoffice/b2b/settings, update_b2b_settings_v1)
//   T2 — UnitsPanel write-mode     (ProductDetail → Units, set_product_units_v1)
//   T3 — CostingPanel + cost fix   (ProductDetail → Costing, update_cost_price_v1)
//   T4 — Order edit ProductPicker  (/backoffice/orders → EditOrderItemsModal)
//
// Project: backoffice (baseURL = E2E_BO_URL or localhost:5174).
//
// IMPORTANT — single shared login: the auth-verify-pin EF is rate-limited to
// 3 req/min/IP (S19 durable rate-limit). Four independent per-test logins
// would trip it, so this suite runs serial and logs in ONCE in beforeAll on a
// shared page. The BO authStore persists the PIN session (S36 boot
// rehydration), so page.reload() inside tests stays authenticated.
//
// DB hygiene: every test restores the values it changes (T1 threshold,
// T2 alt-unit). T3's two cost corrections each append an audited
// stock_movements row on the dev DB — accepted per task brief.
//
// Deviations:
//   DEV-S39-D3-01: T2/T3 use the first product whose cost_price > 0 instead of
//   the literal first row — CorrectCostDialog validates newCost > 0, so a
//   product with WAC cost 0 could never be restored to its original value.
//   DEV-S39-D3-02: T4 self-skips when no draft/pending_payment order exists
//   (task brief forbids creating orders).

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

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Parse "Rp 10.000" / "10.000" (id-ID) into a number. */
function parseIdr(text: string): number {
  const digits = text.replace(/[^\d,]/g, '').replace(/,/g, '.');
  return Number(digits === '' ? 'NaN' : digits.replace(/\.(?=\d{3}(\D|$))/g, ''));
}

/**
 * Open the product detail page of the first listed product whose Costing tab
 * shows a WAC cost > 0 (see DEV-S39-D3-01). Returns the cost found.
 */
async function openFirstCostableProduct(p: Page): Promise<number> {
  await p.goto('/backoffice/products');
  const viewButtons = p.getByRole('button', { name: /^View / });
  await expect(viewButtons.first()).toBeVisible({ timeout: 20_000 });
  const count = Math.min(await viewButtons.count(), 8);

  for (let i = 0; i < count; i++) {
    await p.getByRole('button', { name: /^View / }).nth(i).click();
    await expect(p).toHaveURL(/\/backoffice\/products\/[0-9a-f-]+/, { timeout: 15_000 });
    await p.getByRole('tab', { name: 'Costing' }).click();
    const costCard = p.getByTestId('costing-card-cost');
    await expect(costCard).toBeVisible({ timeout: 15_000 });
    const cost = parseIdr((await costCard.innerText()).split('\n').pop() ?? '');
    if (Number.isFinite(cost) && cost > 0) return cost;
    await p.goto('/backoffice/products');
    await expect(p.getByRole('button', { name: /^View / }).first()).toBeVisible({ timeout: 15_000 });
  }
  throw new Error('No product with cost_price > 0 found in the first rows of the catalog.');
}

// ── T1 — B2B Settings persistence ────────────────────────────────────────────

test('T1: B2B settings — threshold edit persists across reload', async () => {
  await page.goto('/backoffice/b2b/settings');

  const thresholdInput = page.getByLabel('Critical overdue threshold (days)');
  await expect(thresholdInput).toBeVisible({ timeout: 20_000 });

  // S39 removed the read-only stub — its banner must be gone.
  await expect(page.getByText(/read-only preview/i)).toHaveCount(0);

  // Wait for server data to hydrate the draft (Save bar exists but disabled
  // when clean; the loading banner disappears once data arrived).
  await expect(page.getByRole('status', { name: 'Loading settings' })).toHaveCount(0, { timeout: 20_000 });

  const original = Number(await thresholdInput.inputValue());
  expect(Number.isFinite(original)).toBe(true);
  const modified = original + 5 <= 365 ? original + 5 : original - 5;

  const saveBtn = page.getByRole('button', { name: 'Save changes' });

  // Change → Save → toast.
  await thresholdInput.fill(String(modified));
  await expect(saveBtn).toBeEnabled({ timeout: 10_000 });
  await saveBtn.click();
  await expect(page.getByText('B2B settings saved.')).toBeVisible({ timeout: 15_000 });

  // Reload → persisted.
  await page.reload();
  const thresholdAfter = page.getByLabel('Critical overdue threshold (days)');
  await expect(thresholdAfter).toBeVisible({ timeout: 20_000 });
  await expect(thresholdAfter).toHaveValue(String(modified), { timeout: 20_000 });

  // Restore original value (leave DB as found).
  await thresholdAfter.fill(String(original));
  const saveBtn2 = page.getByRole('button', { name: 'Save changes' });
  await expect(saveBtn2).toBeEnabled({ timeout: 10_000 });
  await saveBtn2.click();
  await expect(page.getByText('B2B settings saved.')).toBeVisible({ timeout: 15_000 });

  await page.screenshot({ path: 'test-results/s39-t1.png', fullPage: true });
});

// ── T2 — UnitsPanel write-mode ───────────────────────────────────────────────

test('T2: Units panel — editable for admin, alt-unit edit persists', async () => {
  await openFirstCostableProduct(page);
  await page.getByRole('tab', { name: 'Units' }).click();

  // New S39 panel renders (legacy stub had hardcoded g/kg/gr rows with
  // disabled inputs and no add button).
  const addBtn = page.getByTestId('add-alt-unit-btn');
  await expect(addBtn).toBeVisible({ timeout: 20_000 });
  await expect(addBtn).toBeEnabled();
  await expect(page.getByTestId('context-select-recipe_unit')).toBeEnabled({ timeout: 15_000 });

  const factorInputs = page.getByLabel('Factor to base');
  const hasAlts = (await factorInputs.count()) > 0;

  if (hasAlts) {
    // Branch A — existing alternative: bump its factor by 1, save, reload,
    // assert, then restore.
    const firstFactor = factorInputs.first();
    await expect(firstFactor).toBeEnabled();
    const original = Number(await firstFactor.inputValue());
    const modified = original + 1;

    await firstFactor.fill(String(modified));
    const saveBtn = page.getByTestId('units-save-btn');
    await expect(saveBtn).toBeEnabled({ timeout: 10_000 });
    await saveBtn.click();
    await expect(page.getByText('Units saved.')).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await page.getByRole('tab', { name: 'Units' }).click();
    const factorAfter = page.getByLabel('Factor to base').first();
    await expect(factorAfter).toHaveValue(String(modified), { timeout: 20_000 });

    // Restore.
    await factorAfter.fill(String(original));
    const saveBtn2 = page.getByTestId('units-save-btn');
    await expect(saveBtn2).toBeEnabled({ timeout: 10_000 });
    await saveBtn2.click();
    await expect(page.getByText('Units saved.')).toBeVisible({ timeout: 15_000 });
  } else {
    // Branch B — no alternatives: add e2etmp (factor 2), save, reload,
    // assert present, then remove it and save.
    await expect(page.getByTestId('no-alt-units')).toBeVisible();
    await addBtn.click();
    await page.getByLabel('Unit code').last().fill('e2etmp');
    await page.getByLabel('Factor to base').last().fill('2');
    const saveBtn = page.getByTestId('units-save-btn');
    await expect(saveBtn).toBeEnabled({ timeout: 10_000 });
    await saveBtn.click();
    await expect(page.getByText('Units saved.')).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await page.getByRole('tab', { name: 'Units' }).click();
    await expect(page.getByLabel('Unit code').first()).toHaveValue('e2etmp', { timeout: 20_000 });

    // Remove it again.
    await page.getByRole('button', { name: 'Remove unit e2etmp' }).click();
    const saveBtn2 = page.getByTestId('units-save-btn');
    await expect(saveBtn2).toBeEnabled({ timeout: 10_000 });
    await saveBtn2.click();
    await expect(page.getByText('Units saved.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('no-alt-units')).toBeVisible({ timeout: 15_000 });
  }

  await page.screenshot({ path: 'test-results/s39-t2.png', fullPage: true });
});

// ── T3 — CostingPanel + cost correction round-trip ───────────────────────────

test('T3: Costing panel — KPIs render, cost correction + restore via dialog', async () => {
  const currentCost = await openFirstCostableProduct(page);

  // 3 KPI cards.
  await expect(page.getByTestId('costing-card-cost')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('costing-card-retail')).toBeVisible();
  await expect(page.getByTestId('costing-card-margin')).toBeVisible();

  // Either a BOM table or the "No recipe" EmptyState.
  const bomTable = page.getByTestId('bom-table');
  const emptyState = page.getByText('No recipe — cost is purchase-driven (WAC)');
  await expect(bomTable.or(emptyState)).toBeVisible({ timeout: 20_000 });

  // Correct cost price: +1, then restore.
  const correctBtn = page.getByTestId('correct-cost-btn');
  await expect(correctBtn).toBeVisible({ timeout: 10_000 });

  async function correct(newCost: number, reason: string): Promise<void> {
    await page.getByTestId('correct-cost-btn').click();
    const dialog = page.getByTestId('correct-cost-dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    // Dialog shows the current WAC cost in its description.
    await expect(dialog.getByText(/Current WAC cost/)).toBeVisible();
    await page.getByTestId('correct-cost-new-input').fill(String(newCost));
    await page.getByTestId('correct-cost-reason-input').fill(reason);
    const submit = page.getByTestId('correct-cost-submit');
    await expect(submit).toBeEnabled({ timeout: 5_000 });
    await submit.click();
    await expect(page.getByText(/Cost updated:/)).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });
  }

  await correct(currentCost + 1, 'e2e validation S39');
  await correct(currentCost, 'e2e restore S39');

  await page.screenshot({ path: 'test-results/s39-t3.png', fullPage: true });
});

// ── T4 — Order edit ProductPicker ────────────────────────────────────────────

test('T4: orders list — ProductPicker filters and stages a pending add', async () => {
  await page.goto('/backoffice/orders');
  await expect(page.getByTestId('status-pills')).toBeVisible({ timeout: 20_000 });

  // Surface editable orders (edit action exists only on draft/pending_payment).
  // Try the unfiltered list first; the row-edit testid is status-gated.
  const editButtons = page.locator('[data-testid^="row-edit-"]');
  const hasEditable = await editButtons
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);

  if (!hasEditable) {
    await page.screenshot({ path: 'test-results/s39-t4.png', fullPage: true });
    test.skip(true, 'No draft/pending_payment order exists on the dev DB — task brief forbids creating orders (DEV-S39-D3-02).');
  }

  await editButtons.first().click();

  // EditOrderItemsModal with the real S39 ProductPicker.
  const dialog = page.getByRole('dialog', { name: /Edit order/ });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  const search = page.getByTestId('picker-search');
  await expect(search).toBeVisible({ timeout: 10_000 });

  // Wait for the product list, count rows, then type a query and assert the
  // list filters down.
  const rows = page.locator('[data-testid^="picker-row-"]');
  await expect(rows.first()).toBeVisible({ timeout: 20_000 });
  const allCount = await rows.count();

  // Use the first row's name as a (specific) query so we always match >= 1.
  const firstName = (await rows.first().innerText()).split('\n')[0]?.trim() ?? '';
  const query = firstName.slice(0, Math.min(8, firstName.length));
  await search.fill(query);
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  const filteredCount = await rows.count();
  expect(filteredCount).toBeGreaterThanOrEqual(1);
  expect(filteredCount).toBeLessThanOrEqual(allCount);

  // Pick the first product → a "(new)" pending line appears in the preview.
  await rows.first().click();
  const preview = page.getByTestId('cart-preview');
  await expect(preview.getByText('(new)')).toBeVisible({ timeout: 10_000 });

  await page.screenshot({ path: 'test-results/s39-t4.png', fullPage: true });

  // Cancel — leave the order untouched.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 10_000 });
});
