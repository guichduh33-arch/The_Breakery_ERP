// tests/e2e/opname-finalize.spec.ts
//
// Session 13 / Phase 6.C — E2E: backoffice manager opens an opname session,
// adds a product, counts it, finalises. The `finalize_opname_v1` RPC creates
// the adjustment movements + JE; the opname's own status badge flips to
// "Finalized" on the detail page.
//
// Rewritten S71 — the original spec used inline `/login` + digit-button
// login (BO has no such flow: it's a two-step user-picker → PIN-numpad
// gate) and guessed selectors ('New opname', 'draft' text, an audit-page
// assertion) that don't match the real S14 opname UI. Selectors below are
// read directly from the live components (see paths in each step).
//
// Project: backoffice (baseURL = E2E_BO_URL).
//
// Selector strategy:
//   - openBackofficeSession()      (fixtures/auth.ts) — user-picker + numpad login
//   - #opname-section, #opname-notes            (CreateOpnameModal.tsx)
//   - placeholder "Search by SKU or name…"      (ProductTypeahead.tsx, via AddItemForm.tsx)
//   - aria-label "Counted quantity for <name>"  (CountItemRow.tsx)
//   - OpnameStatusBadge text "Finalized"        (OpnameStatusBadge.tsx)
//
// Determinism: dev is shared staging — each run creates its OWN opname
// (fresh count_id from create_opname_v1) tagged with a unique notes suffix,
// and asserts the finalized status on THAT count's own detail page/URL —
// never a shared total or list `.first()`.
//
// Fixture product: "Agar-Agar" (SKU CON-002, track_inventory=true) — a
// stable raw-material seed row unlikely to be renamed; verified live to be
// the sole match for an "Agar" search.

import { test, expect } from '@playwright/test';
import { openBackofficeSession } from './fixtures/auth';

test.use({ baseURL: process.env.E2E_BO_URL });

const ADMIN_PIN = process.env.E2E_PIN_ADMIN ?? '424242';
const RUN_TAG = process.env.GITHUB_RUN_ID ?? String(Date.now());

test.describe('Opname finalize', () => {
  test('manager creates opname → adds item → counts → finalize → status badge flips', async ({ page }) => {
    test.setTimeout(120_000);

    // ---- Step 1: login ----
    await openBackofficeSession(page, { pin: ADMIN_PIN });

    // ---- Step 2: go to Opname (direct nav — avoids the nested sidebar accordion) ----
    await page.goto('/backoffice/inventory/opname');
    await expect(page.locator('h1').filter({ hasText: 'Stock counts' })).toBeVisible({
      timeout: 30_000,
    });

    // ---- Step 3: create a new opname, unique-tagged via notes ----
    await page.getByRole('button', { name: /new count/i }).click();
    await expect(page.getByText('New stock count')).toBeVisible({ timeout: 10_000 });

    // First real section — placeholder option is index 0.
    await page.locator('#opname-section').selectOption({ index: 1 });
    await page.locator('#opname-notes').fill(`E2E opname-finalize ${RUN_TAG}`);

    await page.getByRole('button', { name: /^create count$/i }).click();

    // useCreateOpname.onSuccess navigates to the fresh count's own detail page.
    await expect(page).toHaveURL(/\/inventory\/opname\/[0-9a-f-]{36}/, { timeout: 25_000 });

    // ---- Step 4: add one item (status auto-flips draft → counting server-side) ----
    const productSearch = page.getByPlaceholder(/search by sku or name/i);
    await productSearch.fill('Agar-Agar');
    await page.getByRole('option', { name: /Agar-Agar/i }).click();
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    // ---- Step 5: count the item ----
    const itemRow = page.locator('table tbody tr').filter({ hasText: 'Agar-Agar' });
    await expect(itemRow).toBeVisible({ timeout: 15_000 });
    await itemRow.getByLabel('Counted quantity for Agar-Agar').fill('10');
    await itemRow.getByRole('button', { name: 'Save' }).click();

    // ---- Step 6: finalize (button appears once status=counting/review and no pending items) ----
    const finalizeBtn = page.getByRole('button', { name: /finalize and post je/i });
    await expect(finalizeBtn).toBeEnabled({ timeout: 15_000 });
    await finalizeBtn.click();

    await expect(page.getByText('Finalize stock count')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Finalize & post JE' }).click();

    // ---- Step 7: this opname's own status badge reaches "Finalized" ----
    await expect(page.getByText('Finalized', { exact: true })).toBeVisible({ timeout: 20_000 });
  });
});
