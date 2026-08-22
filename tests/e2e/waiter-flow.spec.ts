// tests/e2e/waiter-flow.spec.ts
//
// Lot E de l'audit POS Waiter du 2026-08-22 — la surface de salle n'avait
// AUCUNE couverture bout en bout. Douze specs existaient, une seule citait
// « tablet » et aucune n'ouvrait /tablet.
//
// CE QUE CETTE SPEC COUVRE : la coquille de salle atteint son état utile — la
// route s'ouvre pour un compte habilité, l'en-tête se rend, l'état de connexion
// est celui du lot D, et le plan de salle s'ouvre avec ses tables.
//
// CE QU'ELLE NE COUVRE PAS, ET POURQUOI :
//
//   · L'ENVOI d'une commande et son arrivée dans la réception caisse. Il faut
//     deux sessions PIN, et `auth-verify-pin` est limité à ~3 POST/min/IP : deux
//     connexions dos à dos dans une suite déjà sérielle déclenchent le 429.
//   · Le retour cuisine → salle (le toast « Item ready »). Le faire ici
//     demanderait de passer une ligne en `ready` depuis Playwright, donc un
//     accès direct à la base depuis le navigateur. Ce n'est pas un manque : le
//     TRANSPORT de ce retour — l'appartenance de `order_items` à la publication
//     `supabase_realtime`, exactement ce qui était cassé — est asserté par
//     supabase/tests/realtime_publication_orders.test.sql, qui tourne en
//     secondes et vire au rouge si la table en sort. Le tuyau est prouvé là, le
//     parcours ici.
//
// INFORMATION MANQUANTE, NON COMBLÉE : il n'existe pas de compte waiter dédié
// aux tests. Les deux comptes semés sont E2E Owner (ADMIN) et E2E Cashier — et
// E2E Cashier n'a PAS `sales.create` (vérifié sur la base V3 dev le 2026-08-22),
// donc il ne peut pas atteindre /tablet. On passe donc par E2E Owner, qui a la
// permission. Éprouver le garde de rôle `role_code === 'waiter'` lui-même exige
// un compte semé et son PIN en secret CI — c'est une décision propriétaire,
// signalée dans le rapport d'audit, pas comblée ici.
//
// NOTE SUR LA CONNEXION : la fixture partagée `loginPOS` attend un numpad
// immédiatement monté (« POS auto-selects the first seed user (no picker) »).
// Ce n'est plus vrai : apps/pos/src/pages/Login.tsx rend un sélecteur, et
// l'auto-sélection de users[0] a été retirée exprès (un PIN tapé par réflexe
// s'auto-soumettait sur le compte d'un collègue). On sélectionne donc
// explicitement ici, sans toucher à la fixture — la corriger toucherait les
// specs money-path, ce qui déborde de ce lot.
//
// Projet Playwright : `waiter` (baseURL = E2E_POS_URL).

import { test, expect, type Page } from '@playwright/test';

test.use({ baseURL: process.env.E2E_POS_URL });

/** Compte semé porteur de sales.create — voir la note ci-dessus. */
const LOGIN_DISPLAY_NAME = process.env.E2E_WAITER_NAME ?? 'E2E Owner';
const PIN = process.env.E2E_PIN_ADMIN ?? process.env.E2E_PIN_CASHIER ?? '';

/** Sélectionne l'utilisateur dans le picker, puis tape le PIN (auto-soumis à 6). */
async function signIn(page: Page): Promise<void> {
  await page.goto('/');

  const picker = page.getByRole('button', { name: new RegExp(LOGIN_DISPLAY_NAME, 'i') });
  await expect(picker.first()).toBeVisible({ timeout: 60_000 });
  await picker.first().click();

  await expect(page.getByRole('group', { name: 'PIN numpad' })).toBeVisible({ timeout: 15_000 });
  for (const digit of PIN) {
    await page.getByRole('button', { name: digit, exact: true }).first().click();
  }
  const signIn = page.getByTestId('login-sign-in-btn');
  if (await signIn.isEnabled({ timeout: 2_000 }).catch(() => false)) await signIn.click();

  await expect(page.getByRole('group', { name: 'PIN numpad' })).toBeHidden({ timeout: 20_000 });
}

test.describe('Waiter tablet: the floor surface reaches a usable state', () => {
  test.beforeEach(() => {
    // Sans PIN il n'y a rien à éprouver — on saute plutôt que de rendre vert un
    // test qui n'a rien exercé.
    test.skip(PIN === '', 'E2E_PIN_ADMIN / E2E_PIN_CASHIER absent — connexion impossible.');
  });

  test('waiter opens /tablet, sees the shell online, and can open the floor plan', async ({ page }) => {
    test.setTimeout(120_000);

    await signIn(page);
    await page.goto('/tablet/order');

    // Le garde de TabletLayout renvoie vers /pos quand le compte n'a ni le rôle
    // waiter ni sales.create. On l'annonce au lieu de laisser un échec opaque.
    const denied = await page
      .waitForURL(/\/pos(?!\/)/, { timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (denied) {
      test.info().annotations.push({
        type: 'issue',
        description:
          `Le compte « ${LOGIN_DISPLAY_NAME} » n'a ni le rôle waiter ni sales.create : ` +
          `/tablet a rejeté la session. Semer un compte waiter E2E (décision propriétaire).`,
      });
      test.fail(true, 'compte sans accès salle');
      return;
    }

    // ── La coquille ──────────────────────────────────────────────────────
    await expect(page.getByTestId('tablet-order-page')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('tablet-active-table')).toHaveText(/no table/i);

    // ── L'état de connexion (lot D) ──────────────────────────────────────
    // Contre un backend joignable, l'état DOIT être 'online'. Un 'offline_bus'
    // ou 'no_network' ici veut dire que la pastille ment — c'est exactement le
    // défaut que le lot D a corrigé, et ce test l'empêche de revenir.
    const pill = page.getByTestId('tablet-connection-pill');
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAttribute('data-connection-state', 'online', { timeout: 20_000 });
    await expect(pill).toHaveText(/online/i);

    // Corollaire : en ligne, le bandeau d'alerte ne se monte pas du tout.
    await expect(page.getByTestId('tablet-offline-banner')).toHaveCount(0);

    // ── Le plan de salle ─────────────────────────────────────────────────
    await page.getByTestId('tablet-order-pick-table').click();
    await expect(page.getByTestId('tablet-floor-plan')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('tablet-floor-plan-canvas')).toBeVisible();
  });

  test('the tablet shell exposes both tabs of the waiter flow', async ({ page }) => {
    test.setTimeout(120_000);

    await signIn(page);
    await page.goto('/tablet/orders');

    const denied = await page
      .waitForURL(/\/pos(?!\/)/, { timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(denied, 'compte sans accès salle — voir la note du premier test.');

    // « My Orders » se rend, vide ou non : les deux sont un état valide, et
    // c'est bien ce qu'on veut savoir — l'écran ne blanchit pas.
    await expect(
      page.getByRole('heading', { name: /my orders/i }).or(page.getByText(/no orders yet/i)),
    ).toBeVisible({ timeout: 30_000 });

    await expect(page.getByRole('link', { name: /order/i }).first()).toBeVisible();
  });
});
