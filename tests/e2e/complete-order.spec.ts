// tests/e2e/complete-order.spec.ts
//
// Session 13 (orig.) / Session 71 (repair) — E2E: cashier opens the POS,
// logs in via PIN (openPosSession — cold-start-safe, no stale "sign in"
// heading), adds the same sellable product (Americano, SKU COF-011) THREE
// times to build a multi-item cart, opens the payment terminal, pays cash
// exact, and asserts the receipt (SuccessModal, data-testid="receipt-success")
// renders. JE balance is verified server-side by
// `complete_order_with_payment_v17` (the order would not reach `paid` state
// if the JE was unbalanced) — this spec only asserts the client-visible
// success path plus a negative guard against an "unbalanced" toast.
//
// Rewritten S71 (DEV-S71-Task2-01): the original S13-era selectors
// (`product-tile-*`, `/active order/i`, `/checkout|cashier|pay/` generic
// button, `/confirm|complete/` generic button, `/order #?\w/i`) no longer
// exist in the current POS DOM. Modeled on the sibling spec
// `pos-login-order.spec.ts` (single item) and the `addAmericano` guard from
// `s44-money-path.spec.ts`, extended to a 3x add for a real multi-item cash
// sale — this spec's distinguishing purpose vs pos-login-order.
//
// Project: pos (baseURL = E2E_POS_URL or localhost:5173).
//
// Prereqs:
//   - POS app deployed/running at E2E_POS_URL with Supabase pointing at V3 dev.
//   - Dedicated E2E cashier seed user (SEED_USER_CASHIER) with PIN matching
//     E2E_PIN_CASHIER env var, shift already open (Task 1).
//   - Catalog product "Americano" (SKU COF-011) active and sellable.

import { test, expect, type Page } from '@playwright/test';
import { openPosSession } from './fixtures/auth';

test.use({ baseURL: process.env.E2E_POS_URL });

async function addAmericano(p: Page): Promise<void> {
  // The grid defaults to the "Favorites" category (empty on dev), so filter by
  // name via the search box to surface the Americano card regardless of the
  // selected category. Americano = SKU COF-011, Coffee category.
  const search = p.getByRole('searchbox', { name: 'Search products' });
  await expect(search).toBeVisible({ timeout: 20_000 });
  await search.fill('Americano');
  const card = p.getByRole('button', { name: 'Americano — tap to add' }).first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.click();
  // A modifier modal may appear — confirm the pre-selected defaults.
  const addToCart = p.getByRole('button', { name: /add to cart/i });
  if (await addToCart.isVisible().catch(() => false)) {
    await addToCart.click();
  }
  await expect(p.getByTestId('cart-items')).toBeVisible({ timeout: 10_000 });
}

test.describe('Complete a cash order', () => {
  test('cashier login → add 3 items → pay cash → receipt printed', async ({ page }) => {
    test.setTimeout(120_000);

    // ---- Step 1: PIN login (cold-start-safe helper) ----
    await openPosSession(page);

    // After successful login the POS main view should be visible.
    await expect(page.locator('main, [role="main"]').first()).toBeVisible({ timeout: 15_000 });

    // ---- Step 2: add the same product 3x → multi-item cash order ----
    await addAmericano(page);
    await addAmericano(page);
    await addAmericano(page);

    // ---- Step 3: open payment terminal ----
    await page.getByTestId('checkout-cta').click();

    // ---- Step 4: select Cash payment method (pre-selected on open; explicit) ----
    await page.getByTestId('pay-method-cash').click();

    // ---- Step 5: set exact amount ----
    await page.getByRole('button', { name: /^exact/i }).click();

    // ---- Step 6: process payment ----
    const fastPath = page.getByTestId('pay-cash-exact');
    const processBtnVisible = await fastPath.isVisible({ timeout: 2_000 }).catch(() => false);
    if (processBtnVisible) {
      await fastPath.click();
    } else {
      await page.getByRole('button', { name: /process payment/i }).click();
    }

    // ---- Step 7: assert receipt visible ----
    await expect(page.getByTestId('receipt-success')).toBeVisible({ timeout: 15_000 });

    // No JE-unbalanced error toast (negative guard).
    await expect(page.getByText(/je_unbalanced|unbalanced/i)).not.toBeVisible();
  });
});
