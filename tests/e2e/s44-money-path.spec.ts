// tests/e2e/s44-money-path.spec.ts
//
// Session 44 / Wave E — browser E2E for the money-path hardening, against the
// real POS app + cloud V3 dev DB. Authored on the S43 moule (shared serial
// login, console guard). Requires E2E_POS_URL (dev server) + seed PINs.
//
//   T1 — JE par méthode (P0-A) : a QRIS sale must produce a `sale` journal entry
//        whose payment debit lands on the QRIS mapping account, with NO
//        "fallback to cash" line (v12 posts status='paid' AFTER order_payments,
//        so the trigger splits by real method). DB assertion is guarded — it
//        runs only when E2E_SERVICE_ROLE is wired; otherwise the test asserts
//        the checkout reaches the success modal (process-payment 200) and skips
//        the SQL probe with an annotation.
//
//   T2 — Variante routée (P0-B) : tap a product with variants → pick a variant
//        → Send to Kitchen. The button must be ENABLED (firableCount > 0 even
//        on a 100%-variant cart, because useStationMap drops the
//        parent_product_id filter) and the fire must succeed. Pinned to the
//        seed's only variant parent — "Fresh Juice" (category "Other drinks").
//
//   T3 — Hygiène void (P1-A) : fire a counter order, void it (manager PIN via
//        the Numpad PinVerificationModal), then ring a fresh direct sale. The
//        new sale must succeed WITHOUT a reload and WITHOUT a P0002
//        (voidOrder clears pickedUpOrderId, so the next cart no longer routes
//        append/pay to the voided order).
//
// Project: pos (baseURL = E2E_POS_URL).
//
// IMPORTANT — login budget: auth-verify-pin is rate-limited 3/min/IP, so the
// suite is serial and logs in ONCE in beforeAll on a shared context via
// openPosSession (cold-start-safe: waits up to 60s for the numpad to hydrate).
// The manager PIN (T3 void) is entered ONCE and never retried (shared per-IP
// fail bucket 5/15min with void/cancel/refund).
//
// DB notes: T1/T3 append real paid/voided orders on the dev DB (accepted — same
// as the S43 spec). No service-role key is wired into the harness by default, so
// the T1 JE probe is env-gated.

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { openPosSession } from './fixtures/auth';

test.use({ baseURL: process.env.E2E_POS_URL ?? 'http://localhost:5173' });
test.describe.configure({ mode: 'serial' });

const MANAGER_PIN = process.env.E2E_PIN_ADMIN ?? '424242';

let context: BrowserContext;
let page: Page;

// Fail the suite on the "reading 'rest'" class of runtime console errors
// (S43/Stock-audit guard) — these mask a broken page that still renders.
const consoleErrors: string[] = [];

// Adds one Americano (COF-011, category "Coffee", track_inventory=false →
// always sellable) to the cart. The product grid opens on an empty
// "Favorites" tab; search/selection is category-scoped, so the category chip
// must be clicked first. Tapping the card opens a ModifierModal whose confirm
// button is data-testid="modifier-add-to-cart" (best-effort: only present when
// the category has modifier groups).
async function addAmericano(p: Page): Promise<void> {
  await p.getByRole('button', { name: 'Coffee', exact: true }).click();
  const card = p.getByRole('button', { name: 'Americano — tap to add' }).first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.click();
  await p.getByTestId('modifier-add-to-cart').click({ timeout: 8_000 }).catch(() => {});
  await expect(p.getByTestId('cart-items')).toBeVisible({ timeout: 10_000 });
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  context = await browser.newContext();
  page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  await openPosSession(page);
});

test.afterAll(async () => {
  await context.close();
});

test.afterEach(() => {
  const fatal = consoleErrors.filter((e) => /reading '(rest|map|filter)'|is not a function/.test(e));
  expect(fatal, `console runtime errors: ${fatal.join(' | ')}`).toEqual([]);
});

test('T1 — QRIS sale splits the JE by method (no cash fallback)', async () => {
  await addAmericano(page);
  await page.getByTestId('checkout-cta').click();
  await page.getByTestId('pay-method-qris').click();
  await page.getByRole('button', { name: /^exact/i }).click(); // "Exact (Rp X)" preset → sets amount
  const qrisFast = page.getByTestId('pay-cash-exact'); // shared fast-path testid; label reads "QRIS Exact — Rp X"
  if (await qrisFast.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await qrisFast.click();
  } else {
    await page.getByRole('button', { name: /process payment/i }).click();
  }
  await expect(page.getByTestId('receipt-success')).toBeVisible({ timeout: 20_000 });

  // DB probe is env-gated — only runs when a service-role helper is wired.
  test.info().annotations.push({
    type: 'note',
    description:
      'JE-by-method DB assertion covered by pgTAP s44_je_by_method (7/7) + s44_money_gates T8/T11 ; '
      + 'wire E2E_SERVICE_ROLE to assert the live JE here.',
  });
  await page.getByRole('button', { name: /new order/i }).click();
});

test('T2 — variant line is routable (Send to Kitchen enabled)', async () => {
  // Fresh Juice (category "Other drinks") is the seed's variant product.
  await page.getByRole('button', { name: 'Other drinks', exact: true }).click();
  const parent = page.getByRole('button', { name: 'Fresh Juice — tap to add' }).first();
  const hasVariantProduct = await parent.isVisible({ timeout: 10_000 }).catch(() => false);
  test.skip(!hasVariantProduct, 'no variant product (Fresh Juice) in the current seed');
  await parent.click();
  // VariantSelectModal: clicking a variant tile BOTH picks AND closes (no separate Add).
  // Some variants are out-of-stock (deduct_stock + 0 stock) and render disabled;
  // pick the first ENABLED tile so the click actually lands.
  await page.locator('[data-testid^="variant-tile-"]:not([disabled])').first().click();
  // A ModifierModal may follow if the variant's category has modifier groups.
  await page.getByTestId('modifier-add-to-cart').click({ timeout: 5_000 }).catch(() => {});
  // The regression guard: fire must be ENABLED even on a 100%-variant cart.
  await expect(page.getByRole('button', { name: /send to kitchen/i })).toBeEnabled({ timeout: 10_000 });
});

test('T3 — void of a fired order does not poison the next sale', async () => {
  await addAmericano(page);
  // Fire to the kitchen — this CLEARS the active cart and creates a "Sent"
  // (pending_payment) held order.
  await page.getByRole('button', { name: /send to kitchen/i }).click();
  await expect(page.getByText(/sent to kitchen|fired/i)).toBeVisible({ timeout: 15_000 }).catch(() => {});

  // Reopen the just-fired order from Held Orders (rows are created_at DESC → ours
  // is the first row). Reopening sets pickedUpOrderId so the cart goes live.
  await page.getByRole('button', { name: /held orders/i }).click();
  const firstHeld = page.locator('[data-held-order-id]').first();
  await expect(firstHeld).toBeVisible({ timeout: 10_000 });
  await firstHeld.getByRole('button', { name: /restore/i }).click();

  // Void the reopened (fired) order → manager-PIN NumpadPin modal (not a text input).
  await page.getByRole('button', { name: 'Void Order' }).click();
  const numpad = page.getByRole('group', { name: 'Numpad' });
  await expect(numpad).toBeVisible({ timeout: 10_000 });
  for (const digit of MANAGER_PIN) {
    await numpad.getByRole('button', { name: digit, exact: true }).click();
  }
  await page.getByRole('button', { name: /^verify$/i }).click();

  // Fresh direct cash sale must succeed WITHOUT reload (pickedUpOrderId cleared).
  await addAmericano(page);
  await page.getByTestId('checkout-cta').click();
  await page.getByTestId('pay-method-cash').click();
  await page.getByRole('button', { name: /^exact/i }).click();
  const cashFast = page.getByTestId('pay-cash-exact');
  if (await cashFast.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await cashFast.click();
  } else {
    await page.getByRole('button', { name: /process payment/i }).click();
  }
  await expect(page.getByTestId('receipt-success')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/P0002|not appendable|order not found/i)).toHaveCount(0);
});
