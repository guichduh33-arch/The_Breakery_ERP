// tests/e2e/opname-finalize.spec.ts
//
// Session 13 / Phase 6.C — E2E: backoffice manager opens an opname session,
// counts a few items, finalises. The `finalize_opname_v1` RPC creates the
// adjustment movements + JE; the audit_logs row is observable on the Audit
// page.
//
// Prereqs: BO dev server on BO_BASE_URL with a MANAGER+ user (PIN '4321')
// and at least one section.

import { test, expect } from '@playwright/test';

const PIN = process.env.E2E_MANAGER_PIN ?? '4321';

test.describe('Opname finalize', () => {
  test('manager creates opname → counts → finalize → audit row appears', async ({ page }) => {
    await page.goto('/login');

    // Login.
    for (const digit of PIN) {
      await page.getByRole('button', { name: digit, exact: true }).click();
    }
    await page.getByRole('button', { name: /sign in|enter|login/i }).click();

    await expect(page).toHaveURL(/\/backoffice/, { timeout: 10_000 });

    // Go to Opname.
    await page.getByRole('link', { name: /opname/i }).click();
    await expect(page.getByRole('heading', { name: /opname/i })).toBeVisible();

    // Create new opname.
    await page.getByRole('button', { name: /new opname|create/i }).click();
    await expect(page.getByText(/draft/i)).toBeVisible({ timeout: 5_000 });

    // Enter a counted_qty for the first product row.
    const firstCountInput = page.getByPlaceholder(/counted/i).first();
    await firstCountInput.fill('10');

    // Finalize.
    await page.getByRole('button', { name: /finalize/i }).click();
    await page.getByRole('button', { name: /confirm|yes/i }).click();

    // Status should become finalized.
    await expect(page.getByText(/finalized/i)).toBeVisible({ timeout: 10_000 });

    // Audit log: navigate and check that a row exists.
    await page.getByRole('link', { name: /audit/i }).click();
    await expect(page.getByText(/opname\.finalize|stock\.adjust/i).first()).toBeVisible({ timeout: 10_000 });
  });
});
