# S71 — E2E nightly : réparation spec-par-spec + armement cron — Implementation Plan (Plan 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre les 12 specs E2E vertes contre le backend dev V3 en réparant les causes réelles relevées par le triage (dérive du login, précondition « shift ouvert », 3 sélecteurs périmés, 1 locator malformé), puis **armer le cron nightly**.

**Architecture:** On unifie le login sur deux helpers de session (`openPosSession` / `openBackofficeSession`) qui absorbent la latence de démarrage à froid (pré-wait 60 s + `test.setTimeout(120 000)`), on garantit un **shift ouvert** pour le caissier E2E via le provisioning SQL (pas d'UI multi-étapes fragile), et on réaligne chaque sélecteur périmé sur le DOM réel. Chaque tâche rend **une** spec (ou un helper + sa 1ʳᵉ spec) verte et se termine par un run Playwright ciblé.

**Tech Stack:** Playwright `@playwright/test` 1.60, pnpm 9.15 + turbo, Vite 5 `preview`, Supabase cloud dev V3 (`ikcyvlovptebroadgtvd`), psql (provisioning).

## Global Constraints

- **Money-path INTOUCHÉE** : aucune modification de `complete_order_with_payment_v17`, `pay_existing_order_v11`, `create_b2b_order_v5`, `fire_counter_order_v4`, `_record_sale_stock_v1`, ni des Edge Functions, ni des composants d'app. **Ce plan ne touche QUE `tests/e2e/**`, `scripts/e2e/**`, `.github/workflows/playwright-e2e.yml`, et la doc de closeout.** Aucun fichier `apps/**` ni `supabase/migrations/**` n'est modifié (les sélecteurs sont réalignés côté test sur le DOM existant).
- **DB cible = Supabase cloud dev V3** `ikcyvlovptebroadgtvd`. SQL de provisioning via psql (pooler) ou MCP `execute_sql`. **JAMAIS** `pnpm db:reset` / `supabase start`.
- **PIN = exactement 6 chiffres.** Les specs lisent `process.env.E2E_PIN_CASHIER` (caissier `…002`) ou `E2E_PIN_ADMIN` (owner `…001`) — **plus aucun défaut 4 chiffres** (`'1234'`/`'4321'`). En local, le PIN jetable est `424242` (jamais commité).
- **UUID users E2E** : owner `0e2e0000-0000-4000-a000-000000000001` (ADMIN), cashier `0e2e0000-0000-4000-a000-000000000002` (CASHIER). Constantes `SEED_USER_OWNER` / `SEED_USER_CASHIER` dans `tests/e2e/fixtures/auth.ts` (déjà pointées, S71 Plan 1).
- **Cron armé UNIQUEMENT en dernière tâche**, une fois les 12 specs vertes prouvées localement.
- **Déterminisme** : toute spec qui **crée** des entités (opname, PO, commandes) doit agir sur des entités à identifiant unique (suffixe run-id/timestamp) et **asserter un delta**, jamais un total absolu ni le 1ᵉʳ élément d'une liste partagée (dev = staging partagé, sessions swarm concurrentes).

### Environnement d'exécution (préalable lead — vaut pour tous les runs de vérification)

Les runs Playwright de ce plan tapent le backend dev V3 et ont besoin de l'anon key (non commitée). Le **lead** garantit, avant de dispatcher les tâches :
1. Un fichier d'env local **`$CLAUDE_JOB_DIR/tmp/e2e-env.sh`** exportant `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (récupérée via MCP `get_publishable_keys`), `E2E_PIN_ADMIN=424242`, `E2E_PIN_CASHIER=424242`, `E2E_POS_URL=http://localhost:5173`, `E2E_BO_URL=http://localhost:5174`.
2. Le PIN jetable `424242` posé sur les 2 users E2E (MCP `execute_sql`, `hash_pin('424242')`).
3. Un **shift ouvert** pour le caissier E2E (Task 1).

Chaque commande de vérification `Run:` ci-dessous commence par `source "$CLAUDE_JOB_DIR/tmp/e2e-env.sh"`. Le `webServer` de la config rebuild+sert les 2 apps à chaque invocation `playwright test` (≈1–2 min d'amorçage) — c'est normal.

---

### Task 1 : Provisioning — garantir un shift ouvert pour le caissier E2E

**Files:**
- Modify: `scripts/e2e/provision-pins.sql`
- Modify: `.github/workflows/playwright-e2e.yml` (renommer l'étape + commentaire)

**Interfaces:**
- Produces: après provisioning, il existe **toujours** une ligne `pos_sessions` `status='open'` pour `opened_by = 0e2e0000-…-002`. Idempotent (n'insère que s'il n'y en a pas déjà une ouverte). Débloque le dialog « No shift open » des flux de vente POS (Tasks 2, 3, 9).
- **MCP/psql requis pour la vérif** (lead-executed).

Fait vérifié (schéma dev V3) : `pos_sessions` n'a que **2** colonnes NOT NULL sans défaut — `opened_by` (uuid) et `opening_cash` (numeric). `status` a pour défaut `'open'::shift_status` ; `id`/`opened_at`/`cash_in_total`/`cash_out_total` ont des défauts. L'app ouvre un shift par un simple `INSERT INTO pos_sessions (opened_by, opening_cash, …)` (cf. `apps/pos/src/features/shift/hooks/useShift.ts:44-51`).

- [ ] **Step 1 : Ajouter le seed de shift au script de provisioning**

Ajouter à la fin de `scripts/e2e/provision-pins.sql` :

```sql
-- S71 Plan 2 — ensure an OPEN shift exists for the E2E cashier so POS sale
-- flows aren't blocked by the "No shift open" dialog. Idempotent: insert only
-- if the cashier has no open shift. pos_sessions.status defaults to 'open'.
INSERT INTO public.pos_sessions (opened_by, opening_cash)
SELECT '0e2e0000-0000-4000-a000-000000000002', 100000
 WHERE NOT EXISTS (
   SELECT 1 FROM public.pos_sessions
    WHERE opened_by = '0e2e0000-0000-4000-a000-000000000002'
      AND status = 'open'
 );
```

- [ ] **Step 2 : Renommer l'étape du workflow qui l'invoque**

Dans `.github/workflows/playwright-e2e.yml`, renommer l'étape `Provision E2E user PINs` en `Provision E2E state (PINs + open shift)` (le fichier `.sql` invoqué ne change pas — il fait déjà les deux). Remplacer la ligne :

```yaml
      - name: Provision E2E user PINs
```
par :
```yaml
      - name: Provision E2E state (PINs + open shift)
```

- [ ] **Step 3 : Appliquer + vérifier (lead/MCP)**

Le lead exécute le contenu de `provision-pins.sql` (les 2 UPDATE PIN avec `adminpin=cashpin=424242` + l'INSERT shift) via MCP `execute_sql`, puis vérifie :
```sql
SELECT count(*) AS open_shifts FROM public.pos_sessions
 WHERE opened_by='0e2e0000-0000-4000-a000-000000000002' AND status='open';
```
Expected: `open_shifts >= 1`. Re-exécuter le script une 2ᵉ fois → le count **reste** stable (idempotence, pas de doublon).

- [ ] **Step 4 : Commit**

```bash
git add scripts/e2e/provision-pins.sql .github/workflows/playwright-e2e.yml
git commit -m "test(e2e): provision an open E2E cashier shift for POS sale flows (S71)"
```

---

### Task 2 : Helper `openPosSession` + réparer `complete-order.spec.ts`

**Files:**
- Modify: `tests/e2e/fixtures/auth.ts`
- Modify: `tests/e2e/complete-order.spec.ts`

**Interfaces:**
- Produces: `export async function openPosSession(page: Page, pin?: string): Promise<void>` — `goto('/')`, attend le numpad POS jusqu'à 60 s, saisit le PIN (auto-submit à 6 chiffres), asserte la sortie de l'écran de login. Consommé par Tasks 3 et 9.
- Consumes: `SEED_USER_CASHIER`, shift ouvert (Task 1).

Faits DOM (POS `apps/pos/src/pages/Login.tsx`) : pas de picker par défaut (auto-sélection `users[0]`), heading `<h1 id="login-heading">STAFF PIN ACCESS</h1>` (aucun `/sign in/i`), numpad **toujours monté** `<div role="group" aria-label="PIN numpad">` avec `<button aria-label="4">` etc., PIN 6 chiffres **auto-submit**.

- [ ] **Step 1 : Ajouter `openPosSession` à `fixtures/auth.ts`**

Après la fonction `loginPOS` existante (fin du fichier), ajouter :

```ts
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
  await page.goto('/');
  await expect(page.getByRole('group', { name: 'PIN numpad' })).toBeVisible({
    timeout: 60_000,
  });
  for (const digit of pin) {
    await page.getByRole('button', { name: digit, exact: true }).first().click();
  }
  // 6-digit PINs auto-submit; click Sign In only if still present/enabled.
  const signInBtn = page.getByTestId('login-sign-in-btn');
  if (await signInBtn.isEnabled({ timeout: 2_000 }).catch(() => false)) {
    await signInBtn.click();
  }
  await expect(page.getByRole('group', { name: 'PIN numpad' })).toBeHidden({
    timeout: 20_000,
  });
}
```

Ajouter l'import `expect` en tête de `auth.ts` si absent — remplacer la ligne d'import Playwright par :
```ts
import { expect, type Page } from '@playwright/test';
```

- [ ] **Step 2 : Remplacer le login inline de `complete-order.spec.ts`**

Le bloc actuel (`complete-order.spec.ts:17-25`) attend un heading `/sign in/i` inexistant et utilise un PIN 4 chiffres. Remplacer le bloc de login inline :

```ts
await page.goto('/');
await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
for (const digit of PIN) {
  await page.getByRole('button', { name: digit, exact: true }).click();
}
await page.getByRole('button', { name: /sign in|enter|login/i }).click();
```
par un appel au helper :
```ts
await openPosSession(page);
```
et, en tête du `beforeAll`/`beforeEach` concerné, ajouter `test.setTimeout(120_000);`. Ajouter/compléter l'import en haut du fichier :
```ts
import { openPosSession } from './fixtures/auth';
```
Supprimer la constante `PIN`/`E2E_PIN` 4 chiffres devenue inutile (si elle n'est plus référencée).

- [ ] **Step 3 : Rendre les assertions déterministes (si besoin)**

Si la spec asserte un total absolu ou le 1ᵉʳ élément d'une liste partagée, la convertir en delta (capturer l'état avant, agir, asserter la variation). Si elle n'asserte que « un reçu s'affiche après paiement » (flux auto-contenu), aucun changement.

- [ ] **Step 4 : Run vert**

Run: `source "$CLAUDE_JOB_DIR/tmp/e2e-env.sh" && pnpm exec playwright test complete-order --project=pos --retries=0 --reporter=list`
Expected: `1 passed`.

- [ ] **Step 5 : Commit**

```bash
git add tests/e2e/fixtures/auth.ts tests/e2e/complete-order.spec.ts
git commit -m "test(e2e): fix complete-order login via openPosSession helper (S71)"
```

---

### Task 3 : Réparer `s44-money-path.spec.ts` (login à froid)

**Files:**
- Modify: `tests/e2e/s44-money-path.spec.ts`

**Interfaces:**
- Consumes: `openPosSession` (Task 2), shift ouvert (Task 1).

- [ ] **Step 1 : Basculer le `beforeAll` sur `openPosSession` + timeout froid**

Dans `s44-money-path.spec.ts`, le `beforeAll` appelle `loginPOS(page, PIN)` sans allocation de temps à froid. Remplacer l'appel de login par le helper et ajouter le timeout. Dans le `beforeAll`, remplacer :
```ts
await loginPOS(page, PIN);
```
par :
```ts
test.setTimeout(120_000);
await openPosSession(page);
```
Adapter les imports : remplacer `import { loginPOS } from './fixtures/auth';` par `import { openPosSession } from './fixtures/auth';` (conserver les autres imports). Si `PIN` n'est plus utilisé, le supprimer.

- [ ] **Step 2 : Run vert (3 tests sériels)**

Run: `source "$CLAUDE_JOB_DIR/tmp/e2e-env.sh" && pnpm exec playwright test s44-money-path --project=pos --retries=0 --reporter=list`
Expected: `3 passed` (T1 QRIS split, T2 variant routable, T3 void). Si T2/T3 révèlent un sélecteur périmé une fois le login réparé, les corriger sur le même principe (réaligner sur le DOM réel via le rapport d'erreur `test-results/…/error-context.md`) et re-run.

- [ ] **Step 3 : Commit**

```bash
git add tests/e2e/s44-money-path.spec.ts
git commit -m "test(e2e): fix s44-money-path cold-start login (S71)"
```

---

### Task 4 : Helper `openBackofficeSession` + réparer `bo-admin-pin-reset.spec.ts`

**Files:**
- Modify: `tests/e2e/fixtures/auth.ts`
- Modify: `tests/e2e/bo-admin-pin-reset.spec.ts`

**Interfaces:**
- Produces: `export async function openBackofficeSession(page: Page, opts?: { pin?: string; userId?: string }): Promise<void>` — `goto('/')`, attend le bouton `user-picker-<userId>` jusqu'à 60 s, le clique, saisit le PIN, asserte l'URL `/backoffice`. Consommé par Tasks 5 et 6.

Faits DOM (BO `apps/backoffice/src/pages/Login.tsx` + `features/auth/UserPicker.tsx`) : flux 2 étapes **hard-gated** — le `NumpadPin` n'est monté qu'**après** clic d'un `<Button data-testid="user-picker-<uuid>">`. Le pattern gagnant des specs vertes : `expect(getByTestId('user-picker-<owner>')).toBeVisible({timeout:60_000})` **avant** login + `test.setTimeout(120_000)`.

- [ ] **Step 1 : Ajouter `openBackofficeSession` à `fixtures/auth.ts`**

Après `openPosSession`, ajouter :

```ts
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
  await page.goto('/');
  const pickerBtn = page.getByTestId(`user-picker-${userId}`);
  await expect(pickerBtn).toBeVisible({ timeout: 60_000 });
  await pickerBtn.click();
  for (const digit of pin) {
    await page.getByRole('button', { name: digit, exact: true }).first().click();
  }
  const verifyBtn = page.getByRole('button', { name: /verify|sign in/i });
  if (await verifyBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await verifyBtn.click();
  }
  await expect(page).toHaveURL(/\/backoffice/, { timeout: 20_000 });
}
```

- [ ] **Step 2 : Réparer `bo-admin-pin-reset.spec.ts`**

Le spec appelle `loginWithPin(page, ADMIN_PIN, SEED_USER_OWNER)` **à froid** (pas de pré-wait, pas de `test.setTimeout`). Remplacer, dans le `beforeAll`/`beforeEach`, l'appel :
```ts
await loginWithPin(page, ADMIN_PIN, SEED_USER_OWNER);
```
par :
```ts
test.setTimeout(120_000);
await openBackofficeSession(page, { pin: ADMIN_PIN, userId: SEED_USER_OWNER });
```
Adapter les imports : `import { openBackofficeSession, SEED_USER_OWNER } from './fixtures/auth';`. `ADMIN_PIN` doit lire `process.env.E2E_PIN_ADMIN ?? '424242'` (6 chiffres) — corriger si un défaut 4 chiffres traîne.

> ⚠️ **À résoudre par l'implémenteur** : ce spec réinitialise un PIN caissier via l'UI. Vérifier qu'il **ne cible PAS** un compte réel — il doit agir sur un utilisateur de test (idéalement l'E2E cashier `…002`) et **ne pas** laisser le PIN de l'E2E cashier dans un état cassé pour les specs POS suivantes (qui se connectent en `…002`). Si le spec reset le PIN de `…002`, il doit le remettre à `E2E_PIN_CASHIER` en fin de test, ou cibler un autre user de test. Signaler au lead si la cible est ambiguë.

- [ ] **Step 3 : Run vert**

Run: `source "$CLAUDE_JOB_DIR/tmp/e2e-env.sh" && pnpm exec playwright test bo-admin-pin-reset --project=backoffice --retries=0 --reporter=list`
Expected: `1 passed`.

- [ ] **Step 4 : Commit**

```bash
git add tests/e2e/fixtures/auth.ts tests/e2e/bo-admin-pin-reset.spec.ts
git commit -m "test(e2e): openBackofficeSession helper + fix bo-admin-pin-reset (S71)"
```

---

### Task 5 : Réparer `opname-finalize.spec.ts` (login sans user-picker)

**Files:**
- Modify: `tests/e2e/opname-finalize.spec.ts`

**Interfaces:**
- Consumes: `openBackofficeSession` (Task 4).

Fait : le spec fait `goto('/login')` puis tape des chiffres **sans jamais cliquer de user-picker** → le numpad BO n'existe pas → timeout sur '4'.

- [ ] **Step 1 : Remplacer le login inline**

Remplacer le bloc (`opname-finalize.spec.ts:20-22` env.) :
```ts
await page.goto('/login');
for (const digit of PIN) {
  await page.getByRole('button', { name: digit, exact: true }).click();
}
await page.getByRole('button', { name: /sign in|enter|login/i }).click();
```
par :
```ts
test.setTimeout(120_000);
await openBackofficeSession(page, { pin: process.env.E2E_PIN_ADMIN ?? '424242' });
```
Imports : `import { openBackofficeSession } from './fixtures/auth';`. Supprimer la constante `PIN` (`E2E_MANAGER_PIN ?? '4321'`) si plus référencée.

- [ ] **Step 2 : Déterminisme — opname sur entité unique**

Ce spec **crée** un opname. S'assurer qu'il agit sur un nom/note unique (ex. suffixe `process.env.GITHUB_RUN_ID ?? Date.now()`) et asserte **l'apparition de sa propre ligne d'audit** (delta), pas un total. Si la spec asserte déjà « une ligne d'audit apparaît » sur son propre opname, aucun changement.

- [ ] **Step 3 : Run vert**

Run: `source "$CLAUDE_JOB_DIR/tmp/e2e-env.sh" && pnpm exec playwright test opname-finalize --project=backoffice --retries=0 --reporter=list`
Expected: `1 passed`. (Si un sélecteur post-login est périmé, le réaligner via `error-context.md` et re-run.)

- [ ] **Step 4 : Commit**

```bash
git add tests/e2e/opname-finalize.spec.ts
git commit -m "test(e2e): fix opname-finalize login (user-picker) (S71)"
```

---

### Task 6 : Réparer `po-receive.spec.ts` (login sans user-picker)

**Files:**
- Modify: `tests/e2e/po-receive.spec.ts`

**Interfaces:**
- Consumes: `openBackofficeSession` (Task 4).

Fait : même pattern que Task 5 — `goto('/login')` + digits sans user-picker.

- [ ] **Step 1 : Remplacer le login inline**

Remplacer le bloc (`po-receive.spec.ts:18-20` env.) :
```ts
await page.goto('/login');
for (const digit of PIN) {
  await page.getByRole('button', { name: digit, exact: true }).click();
}
await page.getByRole('button', { name: /sign in|enter|login/i }).click();
```
par :
```ts
test.setTimeout(120_000);
await openBackofficeSession(page, { pin: process.env.E2E_PIN_ADMIN ?? '424242' });
```
Imports : `import { openBackofficeSession } from './fixtures/auth';`. Supprimer la constante `PIN` inutilisée.

- [ ] **Step 2 : Déterminisme — PO sur entité unique**

Le spec **crée** un PO et le réceptionne. S'assurer que le PO/produit ciblé est identifiable de façon unique et que les asserts stock/JE sont des **deltas** (stock avant → après réception), pas des totaux absolus. Si déjà le cas, aucun changement.

- [ ] **Step 3 : Run vert**

Run: `source "$CLAUDE_JOB_DIR/tmp/e2e-env.sh" && pnpm exec playwright test po-receive --project=backoffice --retries=0 --reporter=list`
Expected: `1 passed`. (Réaligner tout sélecteur post-login périmé via `error-context.md` si besoin.)

- [ ] **Step 4 : Commit**

```bash
git add tests/e2e/po-receive.spec.ts
git commit -m "test(e2e): fix po-receive login (user-picker) (S71)"
```

---

### Task 7 : Réparer `s39-bo-completion.spec.ts` T4 (sélecteur `orders-filters-bar`)

**Files:**
- Modify: `tests/e2e/s39-bo-completion.spec.ts`

Fait : `getByTestId('orders-filters-bar')` **n'a jamais existé**. La ligne de filtres (`OrdersListPage.tsx:254-285`) est un `<div>` sans testid. Ancre réelle « la liste des commandes a hydraté » : `data-testid="status-pills"` (`OrdersListPage.tsx:288`, sœur immédiate de la ligne de filtres, toujours rendue). Les testids ProductPicker utilisés plus loin (`picker-search`, `picker-row-${id}`) sont **corrects** et inchangés.

- [ ] **Step 1 : Remplacer l'ancre de la page orders**

Dans `s39-bo-completion.spec.ts:246`, remplacer :
```ts
await expect(page.getByTestId('orders-filters-bar')).toBeVisible({ timeout: 20_000 });
```
par :
```ts
await expect(page.getByTestId('status-pills')).toBeVisible({ timeout: 20_000 });
```
(Ne pas toucher aux étapes suivantes : `row-edit-${id}` → `EditOrderItemsModal` → `picker-search` / `picker-row-${id}` sont déjà bons.)

- [ ] **Step 2 : Run vert (T1-T4)**

Run: `source "$CLAUDE_JOB_DIR/tmp/e2e-env.sh" && pnpm exec playwright test s39-bo-completion --project=backoffice --retries=0 --reporter=list`
Expected: `4 passed` (T1-T3 passaient déjà ; T4 doit désormais passer).

- [ ] **Step 3 : Commit**

```bash
git add tests/e2e/s39-bo-completion.spec.ts
git commit -m "test(e2e): fix s39 T4 orders anchor (status-pills, orders-filters-bar never existed) (S71)"
```

---

### Task 8 : Réparer `s41-catalog-import.spec.ts` (nav `link` au lieu de `tab`)

**Files:**
- Modify: `tests/e2e/s41-catalog-import.spec.ts`

Fait : `ProductsPageTabs.tsx` rend des `NavLink` dans `<nav aria-label="Products sections">` → rôle accessible = `link`, **jamais `tab`**. Le snapshot confirme `navigation "Products sections" › link "Products" / link "Import / Export"`. « Americano » (COF-011) est un vrai produit actif.

- [ ] **Step 1 : Remplacer les sélecteurs `tab` par `navigation > link`**

Dans `s41-catalog-import.spec.ts` (autour de 169-179), remplacer :
```ts
await expect(page.getByRole('tab', { name: 'Products', exact: true })).toBeVisible({ timeout: 30_000 });
const importTab = page.getByRole('tab', { name: 'Import / Export' });
await expect(importTab).toBeVisible({ timeout: 10_000 });
await importTab.click();
```
par :
```ts
const productsNav = page.getByRole('navigation', { name: 'Products sections' });
await expect(productsNav.getByRole('link', { name: 'Products', exact: true })).toBeVisible({ timeout: 30_000 });
const importTab = productsNav.getByRole('link', { name: 'Import / Export' });
await expect(importTab).toBeVisible({ timeout: 10_000 });
await importTab.click();
```
(L'assertion d'URL `/backoffice/products/import-export` et les étapes suivantes — `import-dropzone`, download template/export — sont inchangées ; le test ne les avait jamais atteintes, mais elles sont confirmées réelles.)

- [ ] **Step 2 : Run vert (T1, T2, T3, T5)**

Run: `source "$CLAUDE_JOB_DIR/tmp/e2e-env.sh" && pnpm exec playwright test s41-catalog-import --project=backoffice --retries=0 --reporter=list`
Expected: les 4 tests passent (T2/T3/T5 étaient « did-not-run » derrière l'échec de T1). Si T3 (import d'un xlsx `S41E2E`) dépend de données, s'assurer qu'il utilise un SKU/nom unique et nettoie ou tolère la ré-exécution ; réaligner tout sélecteur périmé via `error-context.md`.

- [ ] **Step 3 : Commit**

```bash
git add tests/e2e/s41-catalog-import.spec.ts
git commit -m "test(e2e): fix s41 products nav (link, not tab role) (S71)"
```

---

### Task 9 : Réparer `s43-pos-audit-fixes.spec.ts` (précondition shift + commentaire stale)

**Files:**
- Modify: `tests/e2e/s43-pos-audit-fixes.spec.ts`

**Interfaces:**
- Consumes: `openPosSession` (Task 2) + shift ouvert (Task 1).

Fait : le sélecteur `'Americano — tap to add'` est **correct** (`ProductCard.tsx:74`, aria-label inchangé, Americano = COF-011 réel). L'échec T1 venait du dialog **« No shift open »** — réglé par la précondition shift (Task 1) et un login qui aboutit. Le commentaire du spec référence des SKUs périmés (`BEV-AMER`/`BEV-001`, « twin disabled Americano ») qui n'existent plus.

- [ ] **Step 1 : Aligner le login sur le helper (si le spec a un login inline/loginPOS à froid)**

Si le `beforeAll`/`beforeEach` de `s43-pos-audit-fixes.spec.ts` fait un login inline ou `loginPOS` sans allocation à froid, le remplacer par :
```ts
test.setTimeout(120_000);
await openPosSession(page);
```
et importer `openPosSession` depuis `./fixtures/auth`. (Si le spec utilise déjà un login qui aboutit, ne pas y toucher — la précondition shift de Task 1 suffit alors.)

- [ ] **Step 2 : Corriger le commentaire périmé**

Remplacer le commentaire du helper `addAmericano` (`s43-pos-audit-fixes.spec.ts:52-56`) décrivant les SKUs `BEV-AMER`/`BEV-001` et le « twin disabled » par une note exacte :
```ts
// Adds the sellable "Americano" (SKU COF-011, Coffee) to the cart. The card's
// accessible name is `${product.name} — tap to add` (ProductCard aria-label).
// There is exactly one active Americano in the dev catalog.
```

- [ ] **Step 3 : Run vert (T1, T2, T3)**

Run: `source "$CLAUDE_JOB_DIR/tmp/e2e-env.sh" && pnpm exec playwright test s43-pos-audit-fixes --project=pos --retries=0 --reporter=list`
Expected: `3 passed`. (T1 discount→PIN→cash, T2 tablet-inbox badge, T3 send-to-kitchen persist.)

- [ ] **Step 4 : Commit**

```bash
git add tests/e2e/s43-pos-audit-fixes.spec.ts
git commit -m "test(e2e): s43 relies on open shift + fix stale Americano comment (S71)"
```

---

### Task 10 : Réparer `kiosk-display-realtime.spec.ts` (locator malformé)

**Files:**
- Modify: `tests/e2e/kiosk-display-realtime.spec.ts`

Fait : le locator joint des sélecteurs CSS avec `text=Pair device` dans une seule string → *Unexpected token "=" while parsing css selector*. De plus le texte réel est **« Pair this display »**, pas « Pair device ». Testids confirmés réels : `display-loading`, `display-authenticating`, `display-authenticated`, `display-pair-prompt`, `display-queue-list`, `display-queue-empty`.

- [ ] **Step 1 : Remplacer la string CSS jointe par une chaîne `.or()`**

Remplacer le bloc (`kiosk-display-realtime.spec.ts:54-63`) :
```ts
const knownEl = page.locator([
  '[data-testid="display-loading"]',
  '[data-testid="display-authenticating"]',
  '[data-testid="display-authenticated"]',
  'text=Pair device',
  '[data-testid="display-queue-list"]',
  '[data-testid="display-queue-empty"]',
].join(', '));

await expect(knownEl.first()).toBeVisible({ timeout: 15_000 });
```
par :
```ts
const knownEl = page
  .getByTestId('display-loading')
  .or(page.getByTestId('display-authenticating'))
  .or(page.getByTestId('display-authenticated'))
  .or(page.getByTestId('display-pair-prompt'))
  .or(page.getByTestId('display-queue-list'))
  .or(page.getByTestId('display-queue-empty'));

await expect(knownEl.first()).toBeVisible({ timeout: 15_000 });
```
(`display-pair-prompt` remplace le `text=Pair device` inexistant — plus stable que le heading.)

- [ ] **Step 2 : Run vert**

Run: `source "$CLAUDE_JOB_DIR/tmp/e2e-env.sh" && pnpm exec playwright test kiosk-display-realtime --project=backoffice --retries=0 --reporter=list`
Expected: `1 passed` (l'un des états `display-*` est visible, y compris `display-pair-prompt` sur un display non appairé).

- [ ] **Step 3 : Commit**

```bash
git add tests/e2e/kiosk-display-realtime.spec.ts
git commit -m "test(e2e): fix kiosk-display malformed locator (.or() chain + real testid) (S71)"
```

---

### Task 11 : Run complet vert + armer le cron nightly

**Files:**
- Modify: `.github/workflows/playwright-e2e.yml`

**Interfaces:**
- Consumes: toutes les tâches précédentes vertes.

- [ ] **Step 1 : Run complet des 12 specs (lead, env complet + shift + PIN)**

Le lead garantit PIN `424242` + shift ouvert, puis :
Run: `source "$CLAUDE_JOB_DIR/tmp/e2e-env.sh" && pnpm exec playwright test --reporter=list --retries=1`
Expected: **28 passed / 0 failed** (12 fichiers de spec). Si un test reste rouge, revenir à sa tâche (ne pas armer le cron tant que ce n'est pas 100 % vert). `--retries=1` tolère un flake réseau isolé ; deux échecs consécutifs = vrai bug à corriger.

- [ ] **Step 2 : Armer le cron `schedule`**

Dans `.github/workflows/playwright-e2e.yml`, remplacer :
```yaml
# Cron is DISABLED until the suite is green (Plan 2 arms `schedule`).
on:
  workflow_dispatch:
```
par :
```yaml
# Nightly at 22:00 UTC + on-demand. Suite is green as of S71 Plan 2.
on:
  schedule:
    - cron: '0 22 * * *'
  workflow_dispatch:
```

- [ ] **Step 3 : Valider la config + YAML**

Run: `pnpm exec playwright test --list > /dev/null && python -c "import yaml; yaml.safe_load(open('.github/workflows/playwright-e2e.yml'))"`
Expected: aucune erreur ; `on` contient bien `schedule` **et** `workflow_dispatch`.

- [ ] **Step 4 : Commit**

```bash
git add .github/workflows/playwright-e2e.yml
git commit -m "ci(e2e): arm nightly cron 22:00 UTC — suite green (S71 Plan 2)"
```

---

### Task 12 : Closeout de session S71

**Files:**
- Create: `docs/workplan/plans/2026-07-09-session-71-INDEX.md`
- Modify: `CLAUDE.md` (section Active Workplan)

**Interfaces:**
- Produces: l'INDEX de session (déviations DEV-S71-*, dettes D-*), et le bump du workplan CLAUDE.md.

- [ ] **Step 1 : Écrire l'INDEX de session**

Créer `docs/workplan/plans/2026-07-09-session-71-INDEX.md` résumant : Plan 1 (infra + triage) + Plan 2 (réparation + cron), la liste des specs réparées et leur cause, les déviations (ex. DEV-S71-01 : régénération de types sautée car migration data-only ; DEV-S71-02 : shift ouvert via seed SQL plutôt que l'UI OpenShiftModal ; DEV-S71-03 : timeout webServer 180→300 s), et les dettes ouvertes (ex. minors de la revue finale Plan 1 : fail-fast si anon-key absente ; asymétrie ON CONFLICT de la migration seed).

- [ ] **Step 2 : Bump `CLAUDE.md` Active Workplan**

Mettre à jour la puce « In flight » / « Merged (latest) » de la section *Active Workplan* pour refléter S71 (E2E nightly re-dégelé, 12 specs vertes, cron armé), en suivant le format des sessions précédentes (pointeur vers l'INDEX daté, pas de duplication d'historique).

- [ ] **Step 3 : Vérifier la suite monorepo**

Run: `pnpm typecheck && pnpm build`
Expected: verts (ce plan ne touche que `tests/e2e` + CI + docs ; aucun code d'app).

- [ ] **Step 4 : Commit**

```bash
git add docs/workplan/plans/2026-07-09-session-71-INDEX.md CLAUDE.md
git commit -m "docs(s71): session INDEX + workplan bump — E2E nightly re-armed (S71)"
```

---

## Handoff / Definition of Done (Plan 2)

1. Les 12 fichiers de spec E2E passent (28 tests) localement contre dev V3.
2. Le cron nightly `0 22 * * *` est armé (+ `workflow_dispatch`).
3. **Action utilisateur** : poser les 3 secrets (`VITE_SUPABASE_ANON_KEY`, `E2E_PIN_ADMIN`, `E2E_PIN_CASHIER`) puis déclencher `workflow_dispatch` → prouver la chaîne CI de bout en bout (provision → build → serve → run → 28 verts).
4. INDEX S71 écrit + CLAUDE.md bumpé.

## Self-Review (couverture spec + triage)

- Triage bucket A (login-drift, 5 specs) → Tasks 2, 3, 4, 5, 6 (+ helpers). ✅
- Triage bucket B (sélecteurs, 3 specs) → Tasks 7 (s39), 8 (s41), 9 (s43 = shift, sélecteur OK). ✅
- Triage bucket C (bug spec kiosk) → Task 10. ✅
- Précondition « No shift open » (transverse POS) → Task 1 (seed) consommée par 2/3/9. ✅
- Spec §5.5 (self-seeding / shift dédié) → Task 1 (shift) + notes déterminisme Tasks 5/6/8. ✅
- Spec §5.6 (delta asserts) → folded dans Tasks 2/5/6/8 (déterminisme par spec mutante). ✅
- Spec §2/§8 DoD 13/13 + cron → Task 11 (run complet) + Task 11 Step 2 (cron). ✅ (« 13 » = 12 fichiers réels ; s44 câblée en Plan 1.)
- Money-path intouchée → Global Constraints ; aucune tâche ne touche `apps/**` ni un RPC. ✅
- Cron armé en dernier, après preuve verte → Task 11. ✅
