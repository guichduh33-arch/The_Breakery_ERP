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

import { expect, type Page } from '@playwright/test';

// Seed user IDs — dedicated E2E accounts (S71, migration 20260710000141).
// NOT the legacy 000…001/002 demo accounts: E2E users are isolated so nightly
// PIN resets never touch real staff. PINs are provisioned from CI secrets.
export const SEED_USER_OWNER   = '0e2e0000-0000-4000-a000-000000000001';
export const SEED_USER_CASHIER = '0e2e0000-0000-4000-a000-000000000002';

// ── Rate-limit-resilient login core (S71 Plan 2) ────────────────────────────
// `auth-verify-pin` is durably rate-limited to ~3 POST/min/IP (in-memory +
// Postgres layers, 60s window — supabase/functions/_shared/rate-limit.ts).
// The nightly runs all 12 specs serially from ONE IP; several suites log in
// back-to-back in their beforeAll, so bunched logins trip the limit and the
// EF answers 429. Rather than space specs by hand, every login helper below
// runs through `loginWithRateLimitRetry`: it observes the auth-verify-pin
// response and, on a 429, waits out the window (honouring the Retry-After
// header when present) and retries with a fresh page load. This keeps a
// combined run green without weakening any app-side gate.
const AUTH_VERIFY_PIN_PATH = '/functions/v1/auth-verify-pin';
const LOGIN_MAX_ATTEMPTS = 3;
const RATE_WINDOW_FALLBACK_MS = 62_000;

interface AuthAttemptResult {
  status: number | null;
  retryAfterSec: number;
}

/**
 * Types the PIN (optionally clicking a submit control afterwards) and returns
 * the observed auth-verify-pin HTTP status + Retry-After. The response listener
 * is armed BEFORE the first digit so an auto-submitting 6-digit PIN is caught.
 */
async function enterPinAwaitingAuth(
  page: Page,
  pin: string,
  submit?: () => Promise<void>,
): Promise<AuthAttemptResult> {
  const respP = page
    .waitForResponse(
      (r) => r.url().includes(AUTH_VERIFY_PIN_PATH) && r.request().method() === 'POST',
      { timeout: 20_000 },
    )
    .catch(() => null);
  for (const digit of pin) {
    await page.getByRole('button', { name: digit, exact: true }).first().click();
  }
  if (submit) await submit();
  const resp = await respP;
  if (!resp) return { status: null, retryAfterSec: 0 };
  const ra = Number(resp.headers()['retry-after'] ?? '0');
  return { status: resp.status(), retryAfterSec: Number.isFinite(ra) ? ra : 0 };
}

/**
 * Runs `attempt` (a full navigate → select-user → enter-PIN sequence that
 * returns the auth status) and checks `success`. On an auth-verify-pin 429 it
 * waits out the rate-limit window and retries; other failures retry once
 * quickly (slow cold-start hydration). Leaves the final assertion to the caller.
 */
async function loginWithRateLimitRetry(
  page: Page,
  attempt: () => Promise<AuthAttemptResult>,
  success: () => Promise<boolean>,
): Promise<void> {
  for (let i = 1; i <= LOGIN_MAX_ATTEMPTS; i++) {
    const { status, retryAfterSec } = await attempt();
    if (await success()) return;
    if (i >= LOGIN_MAX_ATTEMPTS) break;
    if (status === 429) {
      const waitMs = retryAfterSec > 0 ? (retryAfterSec + 2) * 1_000 : RATE_WINDOW_FALLBACK_MS;
      await page.waitForTimeout(waitMs);
    }
    // Non-429 failures fall through and retry immediately with a fresh load.
  }
}

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
  // BO two-step gate; rate-limit-resilient (re-navigates on 429 retry).
  await loginWithRateLimitRetry(
    page,
    async () => {
      await page.goto('/');
      const pickerBtn = page.getByTestId(`user-picker-${userId}`);
      await expect(pickerBtn).toBeVisible({ timeout: 60_000 });
      await pickerBtn.click();
      return enterPinAwaitingAuth(page, pin, async () => {
        const verifyBtn = page.getByRole('button', { name: /verify|sign in/i });
        if (await verifyBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await verifyBtn.click();
        }
      });
    },
    async () => {
      try {
        await expect(page).toHaveURL(/\/backoffice/, { timeout: 10_000 });
        return true;
      } catch {
        return false;
      }
    },
  );
}

/**
 * loginPOS — login helper specific to the POS page which has its own bespoke
 * numpad (not NumpadPin) and a gold "Sign In" button.
 *
 * The POS numpad digits are plain <button aria-label="N"> elements inside a
 * role="group" aria-label="PIN numpad" group.
 */
export async function loginPOS(page: Page, pin: string): Promise<void> {
  // POS auto-selects the first seed user (no picker); rate-limit-resilient.
  await loginWithRateLimitRetry(
    page,
    async () => {
      await page.goto('/');
      await expect(page.getByRole('group', { name: 'PIN numpad' })).toBeVisible({
        timeout: 60_000,
      });
      return enterPinAwaitingAuth(page, pin, async () => {
        const signInBtn = page.getByTestId('login-sign-in-btn');
        if (await signInBtn.isEnabled({ timeout: 2_000 }).catch(() => false)) {
          await signInBtn.click();
        }
      });
    },
    async () => {
      try {
        await expect(page.getByRole('group', { name: 'PIN numpad' })).toBeHidden({
          timeout: 10_000,
        });
        return true;
      } catch {
        return false;
      }
    },
  );
}

/**
 * openPosSession — cold-start-safe POS login for beforeAll/serial specs.
 * POS renders no user picker (it auto-selects the first login user) and the
 * numpad is always mounted, so we wait for the numpad group to hydrate (up to
 * 60s for a cold dev server), then type the PIN. A 6-digit PIN auto-submits.
 * Caller MUST have set `test.setTimeout(120_000)` in its beforeAll.
 */
export async function openPosSession(
  page: Page,
  pin: string = process.env.E2E_PIN_CASHIER ?? '424242',
): Promise<void> {
  await loginPOS(page, pin);
  await expect(page.getByRole('group', { name: 'PIN numpad' })).toBeHidden({
    timeout: 20_000,
  });
}

/**
 * openBackofficeSession — cold-start-safe BO login. BO is a hard two-step gate:
 * the numpad only mounts AFTER a user-picker button is clicked. We pre-wait up
 * to 60s for the picker (list_login_users_v1 RPC round-trip on a cold server),
 * click the target user, type the PIN, and assert we reached /backoffice.
 * Caller MUST have set `test.setTimeout(120_000)` in its beforeAll.
 */
export async function openBackofficeSession(
  page: Page,
  opts: { pin?: string; userId?: string } = {},
): Promise<void> {
  const userId = opts.userId ?? SEED_USER_OWNER;
  const pin = opts.pin ?? process.env.E2E_PIN_ADMIN ?? '424242';
  await loginWithPin(page, pin, userId);
  await expect(page).toHaveURL(/\/backoffice/, { timeout: 20_000 });
}
