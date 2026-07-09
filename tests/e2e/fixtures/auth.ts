// tests/e2e/fixtures/auth.ts
//
// Session 21 / Phase 1.B.1 — shared auth helpers for E2E specs.
//
// The POS login page renders a user picker (seed user buttons with
// data-testid="user-picker-{userId}") then a numpad modal. Six-digit PINs
// auto-submit when the last digit is entered. The BO login uses the same
// two-step flow.
//
// All selectors use data-testid or aria attributes — no brittle CSS paths.

import type { Page } from '@playwright/test';

// Seed user IDs — dedicated E2E accounts (S71, migration 20260710000141).
// NOT the legacy 000…001/002 demo accounts: E2E users are isolated so nightly
// PIN resets never touch real staff. PINs are provisioned from CI secrets.
export const SEED_USER_OWNER   = '0e2e0000-0000-4000-a000-000000000001';
export const SEED_USER_CASHIER = '0e2e0000-0000-4000-a000-000000000002';

/**
 * loginWithPin — automates the two-step PIN login UI for both POS and BO.
 *
 * Step 1: click the user picker button identified by data-testid="user-picker-{userId}".
 * Step 2: tap each digit on the numpad (aria-label = digit string).
 *         Six-digit PINs auto-submit on the final digit; shorter PINs need
 *         the "Verify" button. We always click "Verify" as a safety net after
 *         entering all digits.
 *
 * POS login page uses its own numpad (role="group" aria-label="PIN numpad");
 * BO wraps NumpadPin inside a FullScreenModal. Both expose buttons by aria-label.
 *
 * @param page     - Playwright Page object.
 * @param pin      - The PIN string (e.g. "123456"). Must be 4-6 digits.
 * @param userId   - Seed user ID to click in the user picker.
 */
export async function loginWithPin(
  page: Page,
  pin: string,
  userId: string = SEED_USER_OWNER,
): Promise<void> {
  // Step 1: select user from picker (both POS and BO render these buttons).
  const pickerBtn = page.getByTestId(`user-picker-${userId}`);
  if (await pickerBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await pickerBtn.click();
  }

  // Step 2: enter each digit. Numpad keys use aria-label equal to the digit.
  for (const digit of pin) {
    await page.getByRole('button', { name: digit, exact: true }).first().click();
  }

  // Click "Verify" / "Sign In" if visible (shorter PINs don't auto-submit).
  const verifyBtn = page.getByRole('button', { name: /verify|sign in/i });
  if (await verifyBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await verifyBtn.click();
  }
}

/**
 * loginPOS — login helper specific to the POS page which has its own bespoke
 * numpad (not NumpadPin) and a gold "Sign In" button.
 *
 * The POS numpad digits are plain <button aria-label="N"> elements inside a
 * role="group" aria-label="PIN numpad" group.
 */
export async function loginPOS(page: Page, pin: string): Promise<void> {
  // POS Login.tsx does not use a user picker visible by data-testid;
  // the user is already selected (first seed user). Just enter the PIN.
  for (const digit of pin) {
    await page.getByRole('button', { name: digit, exact: true }).first().click();
  }
  // Six-digit PIN auto-submits; shorter pins need the Sign In button.
  const signInBtn = page.getByTestId('login-sign-in-btn');
  if (await signInBtn.isEnabled({ timeout: 2_000 }).catch(() => false)) {
    await signInBtn.click();
  }
}
