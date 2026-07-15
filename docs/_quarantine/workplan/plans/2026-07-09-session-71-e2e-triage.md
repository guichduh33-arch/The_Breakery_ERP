# S71 — Rapport de triage E2E (matrice pass/fail réelle)

- **Date** : 2026-07-09
- **Contexte** : Plan 1 (infra + suite runnable). Run local contre le backend **dev V3**
  (`ikcyvlovptebroadgtvd`), build+serve des 2 apps en localhost (Vite preview
  5173/5174), PIN jetable `424242` sur les 2 users E2E, `--retries=0`.
- **Commande** : `pnpm exec playwright test --reporter=list --retries=0` (env VITE_* +
  E2E_PIN_* + E2E_POS_URL/E2E_BO_URL).
- **Résultat global** : **12 passed · 9 failed · 7 did not run** (28 tests, 12 fichiers de
  spec, 3,6 min). Playwright exit 1.

## Ce que le triage PROUVE (DoD Plan 1)

La chaîne **build → serve localhost → PIN-JWT → dev V3** fonctionne de bout en bout :
12 tests verts, dont des pages BO réelles (s39 T1-T3, s40 T1-T4 avec **export CSV non
vide**, stock-inventory T1-T4) et un login POS complet (pos-login-order). **Les échecs
sont des specs périmées (ère S13/S21), pas l'infra.** Les 2 users E2E dédiés remontent
dans le picker et s'authentifient (les specs qui utilisent le bon helper de login
passent).

> Note « did not run » (7) : ce sont les tests **suivants** dans un fichier
> `test.describe.serial` dont le 1ᵉʳ test a échoué (s43 T2/T3, s44 T2/T3,
> s41 T2/T3/T5) — Playwright saute le reste du groupe sériel. Ils ne sont donc **pas**
> indépendamment évalués ; leur verdict est masqué par l'échec du 1ᵉʳ test du fichier.

## Matrice par spec (12 fichiers)

| Spec | Projet | Verdict | Cause d'échec (1ʳᵉ observée) | Piste de réparation (Plan 2) |
|------|--------|---------|------------------------------|------------------------------|
| pos-login-order | pos | ✅ PASS | — | Référence de login qui marche (`loginPOS`). |
| s40-reports (T1-T4) | bo | ✅ PASS | — | RAS. |
| stock-inventory-pages (T1-T4) | bo | ✅ PASS | — | RAS. |
| s39-bo-completion | bo | ⚠️ 3/4 | T1-T3 ✅ ; **T4** : `getByTestId('orders-filters-bar')` introuvable (20 s) | testid de la barre de filtres orders périmé → réaligner sur le DOM actuel. |
| complete-order | pos | ❌ FAIL | `getByRole('heading', {name:/sign in/i})` introuvable (5 s) — **login** | Le heading « sign in » n'existe plus ; migrer vers le helper `loginPOS` (qui passe). |
| s43-pos-audit-fixes | pos | ❌ FAIL (T1 ; T2/T3 non-run) | login OK puis `getByRole('button',{name:'Americano — tap to add'})` introuvable (20 s) | aria-label de carte produit changé **ou** produit « Americano » absent du catalogue dev → sélecteur + self-seed produit. |
| s44-money-path | pos | ❌ FAIL (T1 ; T2/T3 non-run) | numpad `getByRole('button',{name:'4'})` timeout (10 s) — **login** (chemin picker→numpad de `loginWithPin`) | Unifier sur le login qui marche ; vérifier l'étape user-picker avec les UUID E2E. |
| bo-admin-pin-reset | bo | ❌ FAIL | numpad `button name='4'` timeout — **login** | idem login-drift (helper BO). |
| kiosk-display-realtime | bo | ❌ FAIL | **bug de spec** : locator CSS malformé `[data-testid=…], text=Pair device, …` → *Unexpected token "=" while parsing css selector* | Séparer en `page.locator(...).or(page.getByText('Pair device'))` — un `text=` ne peut pas vivre dans une liste de sélecteurs CSS. |
| opname-finalize | bo | ❌ FAIL | numpad `button name='4'` timeout — **login** (boucle numpad inline du beforeEach) | idem login-drift ; extraire vers le helper commun. |
| po-receive | bo | ❌ FAIL | numpad `button name='4'` timeout — **login** (boucle numpad inline) | idem login-drift. |
| s41-catalog-import | bo | ❌ FAIL (T1 ; T2/T3/T5 non-run) | `getByRole('tab',{name:'Products'})` introuvable (30 s) | l'onglet « Products » de la page produits n'existe plus/renommé → réaligner le sélecteur de navigation. |

## Familles de cause (regroupement pour le Plan 2)

- **A — Dérive du login (5 specs)** : `complete-order`, `s44-money-path`,
  `bo-admin-pin-reset`, `opname-finalize`, `po-receive`. Symptômes : heading
  `/sign in/i` disparu, ou numpad `button name='4'` qui ne matche plus (helpers de
  login divergents / boucles numpad inline périmées). **Référence qui marche** :
  `loginPOS` (pos-login-order ✅) et le login utilisé par s39/s40/stock-inventory ✅.
  → **Chantier Plan 2 n°1** : unifier tous les specs sur `tests/e2e/fixtures/auth.ts`
  et réaligner les sélecteurs numpad/picker sur le DOM actuel (avec les UUID E2E).
- **B — Sélecteurs périmés (3 specs)** : `s39-bo-completion` T4
  (`orders-filters-bar`), `s41-catalog-import` (`tab Products`), `s43-pos-audit-fixes`
  (`Americano — tap to add`, + éventuel self-seed produit). → réalignement ciblé
  par spec.
- **C — Bug de spec (1 spec)** : `kiosk-display-realtime` — locator mélangeant CSS et
  `text=` (erreur de syntaxe Playwright, échoue quel que soit le backend). → correction
  unitaire du locator.

## Verts déjà acquis (à ne pas régresser)

`pos-login-order`, `s40-reports` (4/4), `stock-inventory-pages` (4/4), `s39-bo-completion`
1-3/4. Le Plan 2 doit les garder verts en factorisant le login.

## Suite (Plan 2)

1. Réparer A (login unifié) — débloque le plus grand nombre de specs d'un coup.
2. Réparer B (sélecteurs) + C (bug spec) spec par spec.
3. Rendre les specs mutantes déterministes (asserts delta + entités uniques,
   spec §5.5/5.6) au fil de la réparation.
4. **Action utilisateur** : poser les 3 secrets puis `workflow_dispatch` → prouver la
   chaîne CI. Puis **armer le cron** `schedule: '0 22 * * *'`.
