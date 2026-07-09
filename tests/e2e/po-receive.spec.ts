// tests/e2e/po-receive.spec.ts
//
// Session 13 / Phase 6.C — E2E: create a Purchase Order, receive it. Asserts
// the PO's own status badge flips draft→pending→received and no JE-error
// text appears (the `receive_purchase_order_v2` RPC posts stock + JE
// atomically — see PurchaseOrderDetailPage.tsx).
//
// Rewritten S71 — the original spec used inline `/login` + digit-button
// login (BO has no such flow: it's a two-step user-picker → PIN-numpad
// gate) and guessed selectors ('New (po|purchase order)', getByLabel
// 'supplier' as a combobox, 'Add line/item/product') that don't match the
// real S14 purchasing UI. Selectors below are read directly from the live
// components (see paths in each step).
//
// Project: backoffice (baseURL = E2E_BO_URL).
//
// Selector strategy:
//   - openBackofficeSession()              (fixtures/auth.ts) — user-picker + numpad login
//   - getByLabel('Supplier')               (POFormDraft.tsx — <label htmlFor> wraps a <select>)
//   - #po-form-items select (product) / input[type=number] (qty)  (POFormDraft.tsx line-item row)
//   - button "Create purchase order"       (POFormDraft.tsx submitLabel)
//   - [data-status="pending"|"received"]   (POStatusBadge.tsx — own badge, not the shared list)
//   - button "Receive" / getByLabel('Receive into section') / "Confirm receipt"  (ReceiveDialog.tsx)
//
// Determinism: dev is shared staging — each run CREATES its own PO
// (fresh po_id from create_purchase_order_v2) and pins every assertion to
// THAT PO's own detail page URL and its OWN [data-status] badge — never a
// shared list total or `.first()` of a shared list. No absolute
// stock_movements counts are asserted.
//
// Fixture data (verified live, 2026-07-09): supplier picked by first real
// <option> (any active supplier works — the RPC doesn't care which), raw
// material "Agar-Agar" (SKU CON-002, cost_price 600) — same stable fixture
// product already relied on by opname-finalize.spec.ts — receiving section
// picked by first real <option> (any section works for a plain receive).

import { test, expect } from '@playwright/test';
import { openBackofficeSession } from './fixtures/auth';

test.use({ baseURL: process.env.E2E_BO_URL });

const ADMIN_PIN = process.env.E2E_PIN_ADMIN ?? '424242';

test.describe('PO create + receive', () => {
  test('manager creates PO → receives → own status badge flips to Received', async ({ page }) => {
    test.setTimeout(120_000);

    // ---- Step 1: login ----
    await openBackofficeSession(page, { pin: ADMIN_PIN });

    // ---- Step 2: go straight to the New PO form (direct nav — avoids the
    // nested sidebar accordion, per S71 Task 6 brief) ----
    await page.goto('/backoffice/purchasing/purchase-orders/new');
    await expect(page.locator('h1').filter({ hasText: 'New Purchase Order' })).toBeVisible({
      timeout: 30_000,
    });

    // ---- Step 3: fill the draft — supplier + the one pre-existing line ----
    // Index 0 is the "— Select supplier —" placeholder; index 1 is the
    // first real active supplier (any works, the RPC doesn't gate by name).
    await page.getByLabel('Supplier').selectOption({ index: 1 });

    const itemRow = page.getByTestId('po-form-items').locator('tbody tr').first();
    // Selecting the product auto-fills unit + unit cost from cost_price
    // (POFormDraft.patchItem) — only quantity needs an explicit value.
    await itemRow.locator('select').first().selectOption({ label: 'Agar-Agar (CON-002)' });
    await itemRow.locator('input[type="number"]').first().fill('5');

    // ---- Step 4: submit → navigates to the fresh PO's own detail page ----
    await page.getByRole('button', { name: 'Create purchase order', exact: true }).click();
    await expect(page).toHaveURL(/\/purchasing\/purchase-orders\/[0-9a-f-]{36}/, {
      timeout: 25_000,
    });

    // This PO's own status badge — pending right after create (create_purchase_order_v2).
    await expect(page.locator('[data-status="pending"]')).toBeVisible({ timeout: 15_000 });

    // ---- Step 5: receive the full ordered quantity into the first section ----
    await page.getByRole('button', { name: 'Receive', exact: true }).click();
    await expect(page.getByText('Receive goods')).toBeVisible({ timeout: 10_000 });

    // Index 0 is the "— Select section —" placeholder; index 1 is the first
    // real section. The per-line "receive now" qty is pre-filled with the
    // full remaining quantity (ReceiveDialog useState initializer) — no
    // edit needed for a full receipt.
    await page.getByLabel('Receive into section').selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Confirm receipt', exact: true }).click();

    // ---- Step 6: this PO's own status badge reaches "Received" ----
    await expect(page.locator('[data-status="received"]')).toBeVisible({ timeout: 20_000 });

    // No JE error surfaced (receive_purchase_order_v2 posts stock + JE atomically).
    await expect(page.getByText(/je_unbalanced|trigger_failed/i)).not.toBeVisible();
  });
});
