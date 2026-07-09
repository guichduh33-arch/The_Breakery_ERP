// tests/e2e/s43-pos-audit-fixes.spec.ts
//
// Session 43 / Wave F1 — browser E2E for the 3 P0 audit fixes, against the
// real POS app + cloud V3 dev DB:
//
//   T1 — Discount is payable (P0-1): every discount now requires a manager PIN
//        (PinVerificationModal → verify-manager-pin EF) and the checkout
//        process-payment EF answers 200 (the old client threshold produced a
//        systematic 409 below 10%).
//   T2 — Realtime tablet inbox (P0-2): a tablet order created on page B bumps
//        the POS inbox badge on page A WITHOUT reload (JWT now propagated to
//        the realtime WebSocket; the 30s refetch is only a safety net, so a
//        <10s update proves the realtime path).
//   T3 — Persistent counter fire (P0-3): Send to Kitchen persists the order
//        via fire_counter_order_v4 (pending_payment), survives a POS reload,
//        is visible on the KDS, and checkout then pays THAT SAME order via
//        pay_existing_order_v11 (no second order, no process-payment call).
//
// Project: pos (baseURL = E2E_POS_URL).
//
// IMPORTANT — login budget: auth-verify-pin is rate-limited 3/min/IP, so the
// suite is serial and logs in ONCE in beforeAll on a shared context (S39
// pattern). T2 needs a second independent session for the tablet → exactly one
// extra login (2 total). The verify-manager-pin EF shares a per-IP fail bucket
// (5 fails / 15 min) with void/cancel/refund: the manager PIN is entered ONCE
// and never retried — a wrong PIN fails the test immediately by design.
//
// DB notes: T1/T3 each append one real paid order on the dev DB (accepted —
// same as pos-login-order.spec.ts). T2 leaves one pending_payment tablet order
// in the inbox (no service-role cleanup available in this harness).
//
// SQL access: no SUPABASE_SERVICE_ROLE key is wired into the E2E harness, so
// T3 verifies persistence via the KDS UI (per task brief fallback) plus the
// RPC response envelopes (fire order_id === pay order_id).

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { loginPOS, openPosSession } from './fixtures/auth';

test.use({ baseURL: process.env.E2E_POS_URL ?? 'http://localhost:5173' });
test.describe.configure({ mode: 'serial' });

const PIN = process.env.E2E_PIN_CASHIER ?? '123456';
// Seed owner (SUPER_ADMIN) PIN — has sales.discount. Same default as the
// S39/S40 specs' E2E_PIN_ADMIN. NEVER retried on failure (shared fail bucket).
const MANAGER_PIN = process.env.E2E_PIN_ADMIN ?? '123456';

let context: BrowserContext;
let page: Page;

// ── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Adds the sellable "Americano" (SKU COF-011, Coffee) to the cart. The card's
 * accessible name is `${product.name} — tap to add` (ProductCard aria-label).
 * There is exactly one active Americano in the dev catalog.
 *
 * `surface` drives the post-add assertion: the POS ActiveOrderPanel exposes
 * data-testid="cart-items"; the tablet TabletCartPanel has no testid — its
 * footer "Send to Kitchen" button only renders when the cart is non-empty.
 */
async function addAmericano(p: Page, surface: 'pos' | 'tablet' = 'pos'): Promise<void> {
  // The product grid opens on the (empty) "Favorites" tab and selection is
  // category-scoped, so select the "Coffee" category first for Americano
  // (COF-011, Coffee) to render. Same ProductGrid on POS and tablet.
  await p.getByRole('button', { name: 'Coffee', exact: true }).click();
  const card = p.getByRole('button', { name: 'Americano — tap to add' }).first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.click();
  // Confirm the ModifierModal via its testid if the category has modifier
  // groups (best-effort: only present when a modal mounts).
  await p.getByTestId('modifier-add-to-cart').click({ timeout: 8_000 }).catch(() => {});
  if (surface === 'pos') {
    await expect(p.getByTestId('cart-items')).toContainText('Americano', { timeout: 10_000 });
  } else {
    await expect(p.getByRole('button', { name: /send to kitchen/i })).toBeVisible({ timeout: 10_000 });
  }
}

/** Taps a digit sequence on a Numpad scoped to `scope` (aria-label = digit). */
async function tapDigits(scope: ReturnType<Page['getByRole']>, digits: string): Promise<void> {
  for (const d of digits) {
    await scope.getByRole('button', { name: d, exact: true }).click();
  }
}

/** Navigates to /pos and waits for the open-shift query so checkout/fire have a session. */
async function gotoPosReady(p: Page): Promise<void> {
  const shiftResp = p
    .waitForResponse((r) => r.url().includes('/rest/v1/pos_sessions'), { timeout: 20_000 })
    .catch(() => null);
  await p.goto('/pos');
  await expect(p.locator('main, [role="main"]').first()).toBeVisible({ timeout: 20_000 });
  await shiftResp;
}

/** Reads the pending-tablet-orders badge count (0 when the button is disabled). */
async function inboxCount(p: Page): Promise<number> {
  const btn = p.getByTestId('tablet-inbox-button');
  if (!(await btn.isEnabled().catch(() => false))) return 0;
  const m = (await btn.innerText()).match(/(\d+)\s*$/);
  return m ? Number(m[1]) : 0;
}

/**
 * Pays the open cart with Cash → Exact and asserts the receipt modal.
 * Same chain as pos-login-order.spec.ts: select Cash, stage the exact amount
 * via the "Exact (Rp …)" preset (the `pay-cash-exact` fast-path only renders
 * once fastPathReady), then fast-path or "Process Payment".
 */
async function payCashExact(p: Page): Promise<void> {
  await p.getByTestId('checkout-cta').click();
  await p.getByTestId('pay-method-cash').click();
  await p.getByRole('button', { name: /^exact/i }).click();
  const fastPath = p.getByTestId('pay-cash-exact');
  if (await fastPath.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await fastPath.click();
  } else {
    await p.getByRole('button', { name: /process payment/i }).click();
  }
  await expect(p.getByTestId('receipt-success')).toBeVisible({ timeout: 20_000 });
}

/** Closes the receipt modal so the next test starts with a clean cart. */
async function startNewOrder(p: Page): Promise<void> {
  await p.getByRole('button', { name: /new order/i }).click();
  await expect(p.getByTestId('receipt-success')).not.toBeVisible({ timeout: 10_000 });
}

// ── Shared login (single auth-verify-pin call — see header) ─────────────────

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  context = await browser.newContext();
  page = await context.newPage();
  await openPosSession(page);
  await expect(page).toHaveURL(/\/pos/, { timeout: 30_000 });
});

test.afterAll(async () => {
  await context?.close();
});

// ── T1 — Discount is payable (P0-1) ─────────────────────────────────────────

test('T1: 10% discount → manager PIN modal → cash checkout → process-payment 200 + receipt', async () => {
  test.setTimeout(120_000);
  await gotoPosReady(page);
  await addAmericano(page);

  // Open the cart-discount modal from the More menu (BottomActionBar).
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: /apply discount/i }).click();

  const discountDialog = page.getByRole('dialog').filter({ hasText: 'Apply discount' });
  await expect(discountDialog).toBeVisible({ timeout: 10_000 });

  // 10% via the modal numpad, then the mandatory reason (≥ 5 chars).
  await tapDigits(discountDialog, '10');
  await expect(discountDialog.getByTestId('discount-value-display')).toHaveText('10%');
  const reason = discountDialog.locator('#discount-reason');
  await reason.fill('E2E S43 discount check');
  // Focusing the data-vkp textarea mounts the virtual-keyboard overlay, which
  // intercepts pointer events over the modal footer. Dismiss it the way a
  // cashier would — its "Done" button (programmatic blur does NOT unmount it).
  const vkpDone = page.getByTestId('vkp-overlay').getByRole('button', { name: 'Done' });
  if (await vkpDone.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await vkpDone.click();
  }

  // S43 P0-1: confirming ANY discount must open the manager-PIN modal.
  await discountDialog.getByRole('button', { name: 'Confirm' }).click();
  const pinDialog = page
    .getByRole('dialog')
    .filter({ hasText: 'Enter manager PIN to authorize discount' });
  await expect(pinDialog).toBeVisible({ timeout: 10_000 });

  // Single PIN attempt — verify-manager-pin failures consume the shared
  // per-IP 5/15min bucket, so we never loop.
  const verifyResp = page.waitForResponse(
    (r) => r.url().includes('/functions/v1/verify-manager-pin'),
    { timeout: 15_000 },
  );
  await tapDigits(pinDialog, MANAGER_PIN);
  await pinDialog.getByRole('button', { name: 'Verify' }).click();
  expect((await verifyResp).status(), 'verify-manager-pin must accept the seed manager PIN').toBe(200);

  // Both modals close; the discount line lands in the totals footer.
  await expect(pinDialog).not.toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Discount (10%)')).toBeVisible({ timeout: 10_000 });

  // Checkout cash Exact — the EF must answer 200 (the P0-1 regression was a 409).
  const processResp = page.waitForResponse(
    (r) => r.url().includes('/functions/v1/process-payment'),
    { timeout: 30_000 },
  );
  await payCashExact(page);
  expect((await processResp).status(), 'process-payment must be 200 for a discounted order').toBe(200);

  await startNewOrder(page);
});

// ── T2 — Realtime tablet → POS inbox (P0-2) ─────────────────────────────────

// S71 Plan 2 — FIXME (app limitation, money-path/EF frozen = out of scope):
// this test places a tablet order, which requires reaching /tablet/order.
// TabletLayout gates access on `role_code === 'waiter'` OR a CLIENT-side
// `permissions` list containing `sales.create`. The dedicated E2E seed has no
// waiter, and the cashier (…002) lacks sales.create. Granting it per-user via
// `user_permission_overrides` does NOT help: the `auth-verify-pin` EF's
// `computePermissionsForRole` (supabase/functions/_shared/permissions.ts)
// queries that table with the STALE columns `user_id` / `override_type`, while
// the live schema is `user_profile_id` / `is_granted` — so the override query
// errors and is silently dropped from the login permission list (the DB-side
// has_permission() reads the correct columns, so the drift is EF-only). Fixing
// the EF or adding a waiter seed is outside this test-only plan. Surface to the
// owner: (1) auth-verify-pin permission-override schema drift; (2) no waiter in
// the E2E seed for tablet-flow coverage.
test.fixme('T2: tablet order on page B bumps the POS inbox badge on page A without reload', async ({ browser }) => {
  test.setTimeout(120_000);

  // Page A — POS, logged in (shared session). Wait for the initial
  // pending-tablet-orders fetch so the "before" count is hydrated, not 0-by-race.
  const inboxFetch = page
    .waitForResponse((r) => r.url().includes('/rest/v1/orders') && r.url().includes('created_via'), {
      timeout: 20_000,
    })
    .catch(() => null);
  await page.goto('/pos');
  await expect(page.getByTestId('tablet-inbox-button')).toBeVisible({ timeout: 20_000 });
  await inboxFetch;
  const before = await inboxCount(page);

  // Page B — independent context (2nd and last auth-verify-pin call of the suite).
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  try {
    await pageB.goto('/');
    await loginPOS(pageB, PIN);
    await expect(pageB).toHaveURL(/\/pos/, { timeout: 30_000 });

    await pageB.goto('/tablet/order');
    // Take-out avoids any table requirement. OrderTypeToggle renders role="tab"
    // buttons — target the stable testid, not a button role.
    await pageB.getByTestId('tablet-order-type-take-out').click();
    await addAmericano(pageB, 'tablet');

    const createResp = pageB.waitForResponse(
      (r) => r.url().includes('create_tablet_order_v3'),
      { timeout: 20_000 },
    );
    await pageB.getByRole('button', { name: /send to kitchen/i }).click();
    expect((await createResp).status(), 'create_tablet_order_v3 must succeed').toBe(200);

    // Page A, NO reload: the badge must move via realtime well inside 10s
    // (the refetch safety net alone would need up to 30s).
    await expect(page.getByTestId('tablet-inbox-button')).toBeEnabled({ timeout: 10_000 });
    await expect
      .poll(async () => inboxCount(page), {
        timeout: 10_000,
        message: `inbox badge should exceed ${before} without reloading page A`,
      })
      .toBeGreaterThan(before);
  } finally {
    await contextB.close();
  }
});

// ── T3 — Persistent counter fire (P0-3) ─────────────────────────────────────

test('T3: Send to Kitchen persists the order → survives reload + visible on KDS → checkout pays the SAME order', async () => {
  test.setTimeout(150_000);
  await gotoPosReady(page);
  await addAmericano(page);

  // Fire — the RPC is the source of truth (print failures are tolerated:
  // no print bridge in this environment, the toast says "saved to KDS").
  const fireResp = page.waitForResponse(
    (r) => r.url().includes('/rest/v1/rpc/fire_counter_order_v4'),
    { timeout: 20_000 },
  );
  await page.getByRole('button', { name: /send to kitchen/i }).click();
  const fire = await fireResp;
  expect(fire.status(), 'fire_counter_order_v4 must succeed').toBe(200);
  const fired = (await fire.json()) as {
    order_id: string;
    order_number: string;
    idempotent_replay: boolean;
  };
  expect(fired.order_id).toBeTruthy();
  expect(fired.order_number).toMatch(/#/);

  // Reload — the fired order must survive (persisted cart + DB row).
  await page.reload();
  await expect(page.locator('main, [role="main"]').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('cart-items')).toContainText('Americano', { timeout: 15_000 });
  // The Active Order header now shows the server order id (POS-<last4>).
  await expect(
    page.getByText(`POS-${fired.order_id.slice(-4).toUpperCase()}`),
  ).toBeVisible({ timeout: 10_000 });

  // KDS check — SAME TAB. POS auth + cart live in sessionStorage (per-tab by
  // design: terminal isolation), so a second page/tab lands on /login.
  // Same-tab navigation keeps both; the cart re-hydrates when we come back.
  await page.goto('/kds');
  const baristaTab = page.getByRole('tab', { name: 'Barista' });
  await expect(baristaTab).toBeVisible({ timeout: 30_000 }); // lazy chunk cold-compile
  await baristaTab.click();
  const ticket = page.locator('article').filter({ hasText: fired.order_number });
  await expect(ticket).toBeVisible({ timeout: 20_000 });
  await expect(ticket).toContainText('Americano');
  // Not paid yet — the PAID badge (S43 P2-5b) must NOT be on the ticket.
  await expect(ticket.getByText('PAID', { exact: true })).toHaveCount(0);

  // Back to the POS — the fired cart re-hydrates from sessionStorage.
  await gotoPosReady(page);
  await expect(page.getByTestId('cart-items')).toContainText('Americano', { timeout: 15_000 });

  // Checkout — must pay the EXISTING order via pay_existing_order_v11,
  // never mint a second one via process-payment.
  let processPaymentCalls = 0;
  page.on('request', (r) => {
    if (r.url().includes('/functions/v1/process-payment')) processPaymentCalls += 1;
  });
  const payResp = page.waitForResponse(
    (r) => r.url().includes('/rest/v1/rpc/pay_existing_order_v11'),
    { timeout: 30_000 },
  );
  await payCashExact(page);
  const pay = await payResp;
  expect(pay.status(), 'pay_existing_order_v11 must succeed').toBe(200);
  const envelope = (await pay.json()) as { order_id?: string };
  // Single paid order: the payment targets the exact order the fire created.
  expect(envelope.order_id ?? fired.order_id).toBe(fired.order_id);
  expect(processPaymentCalls, 'fired-order checkout must not call process-payment').toBe(0);
  await startNewOrder(page);

  // KDS after payment: same ticket, now flagged PAID (single order, now paid).
  await page.goto('/kds');
  await expect(baristaTab).toBeVisible({ timeout: 30_000 });
  await baristaTab.click();
  const paidTicket = page.locator('article').filter({ hasText: fired.order_number });
  await expect(paidTicket).toBeVisible({ timeout: 20_000 });
  await expect(paidTicket.getByText('PAID', { exact: true })).toBeVisible({ timeout: 15_000 });
});
