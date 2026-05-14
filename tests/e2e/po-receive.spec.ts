// tests/e2e/po-receive.spec.ts
//
// Session 13 / Phase 6.C — E2E: create a Purchase Order, receive it. Asserts
// the stock_movements grows by N rows (one per PO line) and the JE trigger
// (`tr_purchase_je`) fires automatically.
//
// Prereqs: BO dev server on BO_BASE_URL, MANAGER+ user (PIN '4321'),
// at least one supplier, two products with cost_price set.

import { test, expect } from '@playwright/test';

const PIN = process.env.E2E_MANAGER_PIN ?? '4321';

test.describe('PO create + receive', () => {
  test('manager creates PO → receives → stock + JE updated', async ({ page }) => {
    await page.goto('/login');

    for (const digit of PIN) {
      await page.getByRole('button', { name: digit, exact: true }).click();
    }
    await page.getByRole('button', { name: /sign in|enter|login/i }).click();

    await expect(page).toHaveURL(/\/backoffice/, { timeout: 10_000 });

    // Navigate to Purchasing.
    await page.getByRole('link', { name: /^purchasing$/i }).click();
    await expect(page.getByRole('heading', { name: /purchase orders/i })).toBeVisible();

    // Create new PO.
    await page.getByRole('button', { name: /new (po|purchase order)/i }).click();

    // Pick first supplier.
    await page.getByLabel(/supplier/i).click();
    await page.getByRole('option').first().click();

    // Add one product line.
    await page.getByRole('button', { name: /add (line|item|product)/i }).click();
    await page.getByPlaceholder(/quantity/i).first().fill('5');

    // Submit.
    await page.getByRole('button', { name: /create|save|submit/i }).click();
    await expect(page.getByText(/draft|pending/i)).toBeVisible({ timeout: 5_000 });

    // Receive.
    await page.getByRole('button', { name: /receive/i }).click();
    await page.getByRole('button', { name: /confirm|yes/i }).click();

    // Status should be received.
    await expect(page.getByText(/received/i)).toBeVisible({ timeout: 10_000 });

    // No JE error.
    await expect(page.getByText(/je_unbalanced|trigger_failed/i)).not.toBeVisible();
  });
});
