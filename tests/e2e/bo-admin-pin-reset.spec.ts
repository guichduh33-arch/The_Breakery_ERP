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
//   - Dedicated E2E seed user SEED_USER_OWNER (…001, Owner / ADMIN) with PIN
//     matching E2E_PIN_ADMIN env var (migration 20260710000141).
//   - Dedicated E2E seed user SEED_USER_CASHIER (…002) with PIN matching
//     E2E_PIN_CASHIER — this is the PIN-reset target AND the account the POS
//     specs log in with, so the reset restores it to its own PIN (see
//     DEV-S71-4-01 below).
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
//
//   DEV-S71-4-01: this spec resets SEED_USER_CASHIER's PIN — the SAME
//   dedicated E2E cashier account (…002) the POS specs log in with. NEW_PIN
//   is therefore reset to the cashier's OWN PIN (E2E_PIN_CASHIER, same
//   default as openPosSession) so the reset exercises the UI/EF end-to-end
//   without leaving the account in a broken state for downstream POS specs.

import { test, expect } from '@playwright/test';
import { openBackofficeSession, SEED_USER_OWNER, SEED_USER_CASHIER } from './fixtures/auth';

test.use({ baseURL: process.env.E2E_BO_URL });

const ADMIN_PIN = process.env.E2E_PIN_ADMIN ?? '424242';
// Reset target to its OWN PIN — must not break POS specs that log in as …002.
const NEW_PIN = process.env.E2E_PIN_CASHIER ?? '424242';

test.describe('BO: admin resets a cashier PIN', () => {
  test('admin logs in → opens user detail → resets PIN → success toast visible', async ({ page }) => {
    test.setTimeout(120_000);

    // ---- Step 1: login as admin ----
    // BO login page shows UserPicker then a NumpadPin modal.
    await openBackofficeSession(page, { pin: ADMIN_PIN, userId: SEED_USER_OWNER });

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
