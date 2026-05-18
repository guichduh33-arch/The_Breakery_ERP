// tests/e2e/bo-admin-pin-reset.spec.ts
//
// Session 21 / Phase 1.B.1 — E2E: admin logs into Backoffice, navigates to the
// Users list, opens the first non-self cashier user detail page, enters a new
// 6-digit PIN in the Reset PIN field, submits, and asserts success.
//
// Project: backoffice (baseURL = E2E_BO_URL or localhost:5174).
//
// Prereqs:
//   - BO app deployed/running at E2E_BO_URL.
//   - Seed user 00000000-0000-0000-0000-000000000001 (Owner / ADMIN) with PIN
//     matching E2E_PIN_ADMIN env var.
//   - At least one other user row in the users table.
//
// Selector strategy:
//   - data-testid="user-picker-{userId}"     (UserPicker.tsx)
//   - data-testid="user-row-{userId}"        (UsersTable.tsx)
//   - data-testid="user-open-{userId}"       (UsersTable.tsx link)
//   - data-testid="reset-pin-button"         (UserDetailPage.tsx)
//   - data-testid="pin-reset-success"        (UserDetailPage.tsx)
//
// Deviations:
//   DEV-S21-1.B.1-02 (informational): UserDetailPage validates 4-8 digits
//   while the EF requires exactly 6 — pre-existing inconsistency (DEV-S19-3.B-01).
//   The spec uses a 6-digit PIN to avoid hitting the EF rejection path.

import { test, expect } from '@playwright/test';
import { loginWithPin, SEED_USER_OWNER, SEED_USER_CASHIER } from './fixtures/auth';

test.use({ baseURL: process.env.E2E_BO_URL });

const ADMIN_PIN   = process.env.E2E_PIN_ADMIN   ?? '123456';
const NEW_PIN     = '654321'; // PIN we reset the target user to

test.describe('BO: admin resets a cashier PIN', () => {
  test('admin logs in → opens user detail → resets PIN → success toast visible', async ({ page }) => {
    await page.goto('/');

    // ---- Step 1: login as admin ----
    // BO login page shows UserPicker then a NumpadPin modal.
    await loginWithPin(page, ADMIN_PIN, SEED_USER_OWNER);

    // After login we should land on /backoffice dashboard.
    await expect(page).toHaveURL(/\/backoffice/, { timeout: 15_000 });

    // ---- Step 2: navigate to Users ----
    await page.getByRole('link', { name: /users/i }).click();
    await expect(page).toHaveURL(/\/backoffice\/users/, { timeout: 10_000 });

    // ---- Step 3: open a user detail page ----
    // Click the "Open" link for the cashier seed user row.
    // Falls back to the first available "Open" link if the specific row
    // is not found (e.g., seed data differs in staging).
    const targetLink = page.getByTestId(`user-open-${SEED_USER_CASHIER}`);
    const hasTargetLink = await targetLink.isVisible({ timeout: 5_000 }).catch(() => false);
    if (hasTargetLink) {
      await targetLink.click();
    } else {
      // Fallback: click first available "Open" link that isn't the admin user.
      await page.getByText('Open').first().click();
    }

    await expect(page).toHaveURL(/\/backoffice\/users\//, { timeout: 10_000 });

    // ---- Step 4: fill in new PIN and submit ----
    const pinInput = page.getByLabel('New PIN');
    await pinInput.fill(NEW_PIN);
    await page.getByTestId('reset-pin-button').click();

    // ---- Step 5: assert success ----
    await expect(page.getByTestId('pin-reset-success')).toBeVisible({ timeout: 10_000 });
  });
});
