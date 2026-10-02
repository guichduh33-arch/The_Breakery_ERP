// tests/e2e/s44-money-path.spec.ts
//
// Session 44 / Wave E — browser E2E for the money-path hardening, against the
// real POS app + cloud V3 dev DB. Authored on the S43 moule (shared serial
// login, console guard). Requires E2E_POS_URL (dev server) + seed PINs.
//
//   T1 — Paiement QRIS : réponse HTTP 200 et reçu visible.
//        Aucune vérification comptable n'est exécutée par ce scénario.
//
//   T2 — Variante routée : choisir une variante de Fresh Juice (Other drinks)
//        rend le bouton Send to Kitchen disponible. Aucun envoi n'est effectué.
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
// T1 crée une vente réelle en dev ; T3, si réactivé, crée et annule une commande
// puis crée une vente. Ces mutations exigent une autorisation explicite.

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { openPosSession } from './fixtures/auth';

test.use({ baseURL: process.env.E2E_POS_URL ?? 'http://localhost:5173' });
test.describe.configure({ mode: 'serial' });

const MANAGER_PIN = process.env.E2E_PIN_ADMIN ?? '';

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
  const card = p.getByRole('button', { name: /^Americano\b/ }).first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.click();
  await p.getByTestId('modifier-add-to-cart').click({ timeout: 8_000 }).catch(() => { /* Modale facultative. */ });
  await expect(p.getByTestId('cart-items')).toBeVisible({ timeout: 10_000 });
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  if (!MANAGER_PIN || !process.env.E2E_PIN_CASHIER) throw new Error('Configure E2E_PIN_ADMIN and E2E_PIN_CASHIER before this mutating recipe');
  context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
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

test('T1 — QRIS checkout returns 200 and shows the receipt', async () => {
  await addAmericano(page);
  await page.getByTestId('checkout-cta').click();
  await page.getByTestId('pay-method-qris').click();
  await page.getByRole('button', { name: /^exact/i }).click(); // "Exact (Rp X)" preset → sets amount
  const qrisFast = page.getByTestId('pay-cash-exact'); // shared fast-path testid; label reads "QRIS Exact — Rp X"
  const paymentResponse = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/functions/v1/process-payment',
    { timeout: 20_000 },
  );
  if (await qrisFast.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await qrisFast.click();
  } else {
    await page.getByRole('button', { name: /process payment/i }).click();
  }
  await expect(page.getByTestId('receipt-success')).toBeVisible({ timeout: 20_000 });
  expect((await paymentResponse).status(), 'QRIS checkout must succeed').toBe(200);
  await page.getByRole('button', { name: /new order/i }).click();
});

test('T2 — variant line is routable (Send to Kitchen enabled)', async () => {
  test.setTimeout(120_000);
  // Fresh Juice (category "Other drinks") is the seed's variant product.
  await page.getByRole('button', { name: 'Other drinks', exact: true }).click();
  const parent = page.getByRole('button', { name: /^Fresh Juice\b/ }).first();
  const hasVariantProduct = await parent.isVisible({ timeout: 10_000 }).catch(() => false);
  test.skip(!hasVariantProduct, 'no variant product (Fresh Juice) in the current seed');
  await parent.click();
  // VariantSelectModal: clicking a variant tile BOTH picks AND closes (no separate Add).
  // Some variants are out-of-stock (deduct_stock + 0 stock) and render disabled;
  // pick the first ENABLED tile so the click actually lands.
  await page.locator('[data-testid^="variant-tile-"]:not([disabled])').first().click();
  // A ModifierModal may follow if the variant's category has modifier groups.
  await page.getByTestId('modifier-add-to-cart').click({ timeout: 5_000 }).catch(() => { /* Modale facultative. */ });
  // The regression guard: fire must be ENABLED even on a 100%-variant cart.
  await expect(page.getByRole('button', { name: /send to kitchen/i })).toBeEnabled({ timeout: 10_000 });
  // Clean up so this variant line doesn't bleed into T3's shared cart (serial suite).
  await page.getByRole('button', { name: /^Remove / }).first().click();
});

// Recette mutante : exige le déploiement du contrat d'annulation et une autorisation dev.
test('T3 — void of a fired order does not poison the next sale', async () => {
  test.setTimeout(120_000);
  await addAmericano(page);
  const fireResponse = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/rest/v1/rpc/fire_counter_order_v10',
    { timeout: 20_000 },
  );
  await page.getByRole('button', { name: /send to kitchen/i }).click();
  const fire = await fireResponse;
  expect(fire.status()).toBe(200);
  const fired = await fire.json() as { order_id: string };
  expect(fired.order_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  await expect(page.getByText('Order sent & parked in Held Orders')).toBeVisible({ timeout: 20_000 });

  // Ne jamais annuler une commande préexistante sur la base partagée.
  await page.getByRole('button', { name: /held orders/i }).click();
  const heldOrder = page.locator(`[data-held-order-id="${fired.order_id}"]`);
  await expect(heldOrder).toBeVisible({ timeout: 10_000 });
  await heldOrder.getByRole('button', { name: /restore/i }).click();
  await expect(page.getByRole('dialog', { name: 'Active held orders', exact: true })).not.toBeVisible();

  // Annulation impayée : motif, perte nulle et PIN manager.
  await page.getByRole('button', { name: /^More/ }).click();
  await page.getByRole('button', { name: 'Cancel unpaid order', exact: true }).click();
  const voidDialog = page.getByRole('dialog', { name: 'Cancel unpaid order', exact: true });
  await voidDialog.getByLabel('Reason', { exact: true }).fill('E2E: cancel this test order');
  const keyboardDone = page.getByTestId('vkp-overlay').getByRole('button', { name: 'Done' });
  if (await keyboardDone.isVisible()) await keyboardDone.click();
  await voidDialog.getByLabel(/Waste quantity/).fill('0');
  const numpad = voidDialog.getByRole('group', { name: 'Numpad' });
  await expect(numpad).toBeVisible({ timeout: 10_000 });
  for (const digit of MANAGER_PIN) {
    await numpad.getByRole('button', { name: digit, exact: true }).click();
  }
  const voidResponse = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/functions/v1/cancel-unpaid-order',
    { timeout: 20_000 },
  );
  const verify = voidDialog.getByRole('button', { name: /^verify$/i });
  await verify.scrollIntoViewIfNeeded();
  await expect(verify).toBeInViewport();
  await verify.click();
  const voided = await voidResponse;
  expect((voided.request().postDataJSON() as { order_id?: string }).order_id).toBe(fired.order_id);
  expect(voided.status()).toBe(200);
  expect((await voided.json() as { order_id?: string }).order_id).toBe(fired.order_id);

  // Attendre le reset avant la nouvelle vente pour détecter un UUID résiduel.
  await expect(page.getByText(/select products to begin/i)).toBeVisible({ timeout: 15_000 });

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
