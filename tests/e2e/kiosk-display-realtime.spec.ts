// tests/e2e/kiosk-display-realtime.spec.ts
//
// Session 21 / Phase 1.B.1 — E2E: open the POS customer display route (/display)
// and assert the page loads. The customer display is a kiosk surface served from
// the POS app and uses a kiosk JWT (issued by kiosk-issue-jwt Edge Function).
//
// Realtime broadcast testing is deliberately soft/informational. Deterministic
// realtime testing (asserting a DOM update in response to a DB INSERT) would
// require a second page context / playwright fixtures and is deferred.
//
// Project: backoffice (uses E2E_BO_URL env, but /display is on the POS app).
// We re-assign baseURL to E2E_POS_URL in the spec to point at the POS origin.
//
// Auth: the /display route shows a PairDevicePrompt when unpaired.
//   - If E2E_KIOSK_JWT is set, we inject it into localStorage before navigation
//     so the kiosk auth hook picks it up and reaches the authenticated state.
//   - If not set, we assert the pair-device or loading screen is visible instead
//     (soft assertion — documents as DEV-S21-1.B.1-03).
//
// Deviations:
//   DEV-S21-1.B.1-03 (informational): realtime broadcast not tested
//   deterministically; asserting DOM update from a background DB change requires
//   a playwright multi-context fixture out of scope for this nightly smoke run.
//   DEV-S21-1.B.1-04 (informational): when E2E_KIOSK_JWT is absent the test
//   asserts pair-prompt visibility instead of full authenticated display — the
//   pairing flow itself is not automated (requires a separate kiosk_id setup).

import { test, expect } from '@playwright/test';

// Customer display lives in the POS app — override baseURL.
const POS_URL = process.env.E2E_POS_URL ?? process.env.E2E_BASE_URL ?? 'http://localhost:5173';

test.describe('Kiosk display: page loads', () => {
  test('navigating to /display renders a known testid', async ({ page }) => {
    // If a kiosk JWT is provided, inject it into localStorage so the kiosk-auth
    // hook transitions to "authenticated" instead of showing the pair prompt.
    const kioskJwt = process.env.E2E_KIOSK_JWT;
    if (kioskJwt) {
      await page.goto(POS_URL);
      await page.evaluate((jwt) => {
        // kioskAuth.ts stores pairing under 'breakery_kiosk_pairing' in localStorage.
        const pairing = { kiosk_id: 'e2e-screen', jwt };
        localStorage.setItem('breakery_kiosk_pairing', JSON.stringify(pairing));
      }, kioskJwt);
    }

    await page.goto(`${POS_URL}/display`);

    // Wait for one of the known render branches:
    //   "display-loading"       — pairing check in flight (transient)
    //   "display-authenticating"— JWT auth in progress (transient)
    //   "display-authenticated" — happy path
    //   PairDevicePrompt        — no pairing, shows "Pair device" heading
    const knownEl = page
      .getByTestId('display-loading')
      .or(page.getByTestId('display-authenticating'))
      .or(page.getByTestId('display-authenticated'))
      .or(page.getByTestId('display-pair-prompt'))
      .or(page.getByTestId('display-queue-list'))
      .or(page.getByTestId('display-queue-empty'));

    await expect(knownEl.first()).toBeVisible({ timeout: 15_000 });

    // Annotate if we reached authenticated state or not (informational).
    const isAuthenticated = await page
      .getByTestId('display-authenticated')
      .isVisible({ timeout: 2_000 })
      .catch(() => false);

    test.info().annotations.push({
      type: 'info',
      description: isAuthenticated
        ? 'Display reached authenticated state; orders list visible.'
        : 'DEV-S21-1.B.1-04: Display not authenticated — pair prompt or loading shown (expected when E2E_KIOSK_JWT not set).',
    });

    // Soft: no hard JS error banners.
    await expect(page.getByText(/unexpected error|js error|crash/i)).not.toBeVisible();
  });
});
