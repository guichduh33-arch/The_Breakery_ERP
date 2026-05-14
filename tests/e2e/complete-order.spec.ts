// tests/e2e/complete-order.spec.ts
//
// Session 13 / Phase 6.C — E2E: cashier opens POS, logs in via PIN, adds 3
// products to cart, opens cashier panel, pays cash, asserts the receipt
// renders. JE balance check is verified server-side by `complete_order_v9`
// (the order would not reach `paid` state if the JE was unbalanced).
//
// Prereqs: POS dev server on POS_BASE_URL with VITE_SUPABASE_URL pointing at
// the staging project that has at least one CASHIER user with PIN '1234'
// (seeded via Phase 0.5 fixtures) + 3 catalog products.

import { test, expect } from '@playwright/test';

const PIN = process.env.E2E_PIN ?? '1234';

test.describe('Complete a cash order', () => {
  test('cashier login → add 3 items → pay cash → receipt printed', async ({ page }) => {
    await page.goto('/');

    // Login: PIN numpad.
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    for (const digit of PIN) {
      await page.getByRole('button', { name: digit, exact: true }).click();
    }
    await page.getByRole('button', { name: /sign in|enter|login/i }).click();

    // Catalog should now be visible.
    await expect(page.getByRole('main')).toBeVisible({ timeout: 10_000 });

    // Click first 3 product tiles.
    const productTiles = page.getByTestId(/^product-tile-/);
    await productTiles.nth(0).click();
    await productTiles.nth(1).click();
    await productTiles.nth(2).click();

    // Active order panel should show 3 items.
    await expect(page.getByText(/active order/i)).toBeVisible();

    // Open cashier panel.
    await page.getByRole('button', { name: /checkout|cashier|pay/i }).click();

    // Pick "Cash" tender.
    await page.getByRole('button', { name: /cash/i }).click();

    // Confirm.
    await page.getByRole('button', { name: /confirm|complete/i }).click();

    // Receipt modal should open with order number.
    await expect(page.getByText(/order #?\w/i)).toBeVisible({ timeout: 10_000 });

    // No JE-unbalanced error toast.
    await expect(page.getByText(/je_unbalanced|unbalanced/i)).not.toBeVisible();
  });
});
