# S71 — E2E nightly : Infra + suite runnable + triage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre la suite E2E Playwright *exécutable* contre le backend Supabase dev V3 (build+serve in-CI, users E2E dédiés, PINs via secrets), puis produire un **rapport de triage** pass/fail réel des 13 specs — sans encore réparer les specs elles-mêmes.

**Architecture:** Job GitHub Actions auto-contenu : build+preview des 2 apps en localhost (Vite), Playwright pilote localhost, auth via PIN-JWT contre dev V3. Une migration de seed additive crée 2 users E2E dédiés ; leurs PINs sont posés au run par un script SQL depuis les secrets (jamais commités). Ce plan est **l'étape 1** ; la réparation spec-par-spec est un plan séparé (Plan 2) écrit à partir du triage.

**Tech Stack:** Playwright `@playwright/test` (config racine), pnpm 9.15 + turbo, Vite 5 `preview`, Supabase cloud dev V3 (`ikcyvlovptebroadgtvd`), psql (provisioning), migrations via MCP `apply_migration`.

## Global Constraints

- **Money-path INTOUCHÉE** : aucune modification de `complete_order_with_payment_v17`, `pay_existing_order_v11`, `create_b2b_order_v5`, `fire_counter_order_v4`, `_record_sale_stock_v1`, ni des Edge Functions. Session **test-only + CI + une migration de seed additive**.
- **DB cible = Supabase cloud dev V3** `ikcyvlovptebroadgtvd` — migrations via MCP `mcp__claude_ai_Supabase__apply_migration`, SQL via `execute_sql`, types via `generate_typescript_types`. **JAMAIS** `pnpm db:reset` / `supabase start` (Docker retiré).
- **Numérotation migration monotone** : prochaine = `20260710000141` (la plus haute existante est `20260710000140`). Pas de `BEGIN;/COMMIT;` dans le corps (MCP wrappe déjà).
- **PIN = exactement 6 chiffres** (standard projet depuis S58). Placeholder de seed `'000000'`, écrasé au run par le secret.
- **UUID users E2E dédiés** (aucune réutilisation de `…001/…002`) :
  - Owner   : `0e2e0000-0000-4000-a000-000000000001` (rôle `ADMIN`, `employee_code` `E2E001`)
  - Cashier : `0e2e0000-0000-4000-a000-000000000002` (rôle `CASHIER`, `employee_code` `E2E002`)
- **Noms de packages pnpm** : POS = `@breakery/app-pos`, BO = `@breakery/app-backoffice`. Ports preview : POS `5173`, BO `5174`.
- **Tâches nécessitant le MCP Supabase** (à exécuter par le lead, pas un subagent MCP-less — cf. mémoire `sdd-subagent-tooling`) : Task 2 (apply_migration + verify), Task 6 triage local (execute_sql + get anon key).
- **Cron NON armé dans ce plan** : le workflow reste `workflow_dispatch` seul tant que la suite n'est pas verte. L'armement du cron `schedule` est la dernière étape du Plan 2.

---

### Task 1 : `playwright.config.ts` — webServer build+preview + câbler s44

**Files:**
- Modify: `playwright.config.ts` (racine)

**Interfaces:**
- Produces: 2 serveurs Playwright (`http://localhost:5173` POS, `http://localhost:5174` BO) démarrés automatiquement par la config ; projet `pos` inclut désormais `s44-money-path.spec.ts`.

- [ ] **Step 1 : Ajouter le bloc `webServer` et câbler s44**

Remplacer le contenu de `playwright.config.ts` par :

```ts
// playwright.config.ts
//
// Session 13 / Phase 6.C — Playwright config for cross-app E2E.
// Session 21 — pos + backoffice named projects, E2E_POS_URL / E2E_BO_URL.
// Session 71 — webServer build+preview in-CI (dev V3 backend), s44 wired.
//
// CI: the job builds + serves both apps on localhost via `webServer` below,
// with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY pointing at the dev V3
// project. `pnpm exec playwright test --list` works without any server.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // E2E specs may share dev DB state — run serially.
  forbidOnly: !!process.env.CI,
  retries: 2,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
  },
  webServer: [
    {
      command:
        'pnpm --filter @breakery/app-pos build && pnpm --filter @breakery/app-pos preview --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command:
        'pnpm --filter @breakery/app-backoffice build && pnpm --filter @breakery/app-backoffice preview --port 5174 --strictPort',
      url: 'http://localhost:5174',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
  projects: [
    {
      name: 'pos',
      testMatch: /(complete-order|pos-login-order|s43-pos-audit-fixes|s44-money-path)\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.E2E_POS_URL ?? process.env.E2E_BASE_URL ?? 'http://localhost:5173',
      },
    },
    {
      name: 'backoffice',
      testMatch: /(opname-finalize|po-receive|bo-admin-pin-reset|kiosk-display-realtime|s39-bo-completion|s40-reports|s41-catalog-import|stock-inventory-pages)\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.E2E_BO_URL ?? process.env.E2E_BASE_URL ?? 'http://localhost:5174',
      },
    },
  ],
});
```

- [ ] **Step 2 : Vérifier que la config parse et que s44 est câblée sous `pos`**

Run: `pnpm exec playwright test --list --project=pos`
Expected: la sortie liste `s44-money-path.spec.ts` (en plus de complete-order, pos-login-order, s43-pos-audit-fixes). Aucune erreur de parsing config. (Ne démarre PAS de serveur — `--list` n'invoque pas `webServer`.)

- [ ] **Step 3 : Commit**

```bash
git add playwright.config.ts
git commit -m "test(e2e): webServer build+preview in-CI + wire s44-money-path (S71)"
```

---

### Task 2 : Migration de seed — 2 users E2E dédiés

**Files:**
- Create: `supabase/migrations/20260710000141_seed_e2e_users.sql`
- Modify (si drift) : `packages/supabase/src/types.generated.ts`

**Interfaces:**
- Produces: 2 lignes `user_profiles` actives (owner ADMIN `0e2e0000-…-001`, cashier CASHIER `0e2e0000-…-002`) + leurs `auth.users`, retournées par `list_login_users_v1()`. `pin_hash` = placeholder `hash_pin('000000')`, écrasé au run (Task 3/6).
- **MCP requis** (lead-executed).

- [ ] **Step 1 : Écrire la migration (miroir exact du template waiter `20260507000002`)**

Créer `supabase/migrations/20260710000141_seed_e2e_users.sql` :

```sql
-- 20260710000141_seed_e2e_users.sql
-- S71 — E2E nightly : seed 2 dedicated E2E users (owner ADMIN, cashier CASHIER).
-- Additive & idempotent. PINs are placeholders here ('000000') and are
-- overwritten at CI run time from secrets by scripts/e2e/provision-pins.sql
-- (so real PIN values never live in the repo). Mirrors the waiter-demo seed
-- pattern (20260507000002): one auth.users row + one user_profiles row sharing
-- the same UUID (id = auth_user_id) so auth.uid() maps to the profile under
-- PIN-JWT and has_permission() resolves the role.

DO $$
DECLARE
  v_owner_uid   UUID := '0e2e0000-0000-4000-a000-000000000001';
  v_cashier_uid UUID := '0e2e0000-0000-4000-a000-000000000002';
BEGIN
  -- auth.users rows (password login disabled — PIN-JWT only)
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_user_meta_data, raw_app_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    created_at, updated_at
  ) VALUES
    (v_owner_uid, '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'e2e-owner@thebreakery.local',
     crypt('disabled-password-' || gen_random_uuid(), gen_salt('bf')),
     now(), '{"provider":"pin"}'::jsonb, '{"provider":"pin","providers":["pin"]}'::jsonb,
     '', '', '', '', now(), now()),
    (v_cashier_uid, '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'e2e-cashier@thebreakery.local',
     crypt('disabled-password-' || gen_random_uuid(), gen_salt('bf')),
     now(), '{"provider":"pin"}'::jsonb, '{"provider":"pin","providers":["pin"]}'::jsonb,
     '', '', '', '', now(), now())
  ON CONFLICT (id) DO NOTHING;

  -- user_profiles rows (placeholder PIN, overwritten at run time)
  INSERT INTO user_profiles (
    id, auth_user_id, employee_code, full_name, pin_hash, role_code, is_active
  ) VALUES
    (v_owner_uid,   v_owner_uid,   'E2E001', 'E2E Owner',   hash_pin('000000'), 'ADMIN',   true),
    (v_cashier_uid, v_cashier_uid, 'E2E002', 'E2E Cashier', hash_pin('000000'), 'CASHIER', true)
  ON CONFLICT (employee_code) DO NOTHING;
END $$;
```

- [ ] **Step 2 : Appliquer via MCP**

Lead exécute `mcp__claude_ai_Supabase__apply_migration` avec `project_id='ikcyvlovptebroadgtvd'`, `name='seed_e2e_users'`, `query=<contenu ci-dessus>`.
Expected: succès, pas d'erreur FK (rôles `ADMIN`/`CASHIER` existent depuis l'init).

- [ ] **Step 3 : Vérifier que les 2 users remontent dans le picker de login**

Lead exécute `mcp__claude_ai_Supabase__execute_sql` :
```sql
SELECT id, display_name, role FROM list_login_users_v1()
WHERE id IN ('0e2e0000-0000-4000-a000-000000000001',
             '0e2e0000-0000-4000-a000-000000000002');
```
Expected: 2 lignes (`E2E Owner` / role Admin ; `E2E Cashier` / role Cashier).

- [ ] **Step 4 : Regen types + confirmer no-drift**

Lead exécute `mcp__claude_ai_Supabase__generate_typescript_types`, écrit dans `packages/supabase/src/types.generated.ts`.
Run: `git diff --stat packages/supabase/src/types.generated.ts`
Expected: **aucun changement** (seed data-only, pas de changement de schéma). Si diff → committer.

- [ ] **Step 5 : Commit**

```bash
git add supabase/migrations/20260710000141_seed_e2e_users.sql packages/supabase/src/types.generated.ts
git commit -m "test(e2e): seed dedicated E2E users (owner ADMIN + cashier CASHIER) (S71)"
```

---

### Task 3 : Script de provisioning des PINs (SQL, depuis secrets)

**Files:**
- Create: `scripts/e2e/provision-pins.sql`

**Interfaces:**
- Consumes: variables psql `:'adminpin'` / `:'cashpin'` (injectées par le workflow depuis `E2E_PIN_ADMIN`/`E2E_PIN_CASHIER`), connexion `V3_DEV_PG_POOLER_URL`.
- Produces: `pin_hash` des 2 users E2E mis à jour depuis les secrets, lockout remis à zéro. Idempotent.

- [ ] **Step 1 : Écrire le script SQL**

Créer `scripts/e2e/provision-pins.sql` :

```sql
-- scripts/e2e/provision-pins.sql
-- S71 — set the 2 E2E users' PINs from CI secrets (never committed).
-- Invoked by playwright-e2e.yml:
--   psql "$V3_DEV_PG_POOLER_URL" -v ON_ERROR_STOP=1 \
--     -v adminpin="$E2E_PIN_ADMIN" -v cashpin="$E2E_PIN_CASHIER" \
--     -f scripts/e2e/provision-pins.sql
-- hash_pin() = crypt(pin, gen_salt('bf',10)) — verified by verify_user_pin().
UPDATE public.user_profiles
   SET pin_hash = public.hash_pin(:'adminpin'),
       failed_login_attempts = 0,
       locked_until = NULL
 WHERE id = '0e2e0000-0000-4000-a000-000000000001';

UPDATE public.user_profiles
   SET pin_hash = public.hash_pin(:'cashpin'),
       failed_login_attempts = 0,
       locked_until = NULL
 WHERE id = '0e2e0000-0000-4000-a000-000000000002';
```

- [ ] **Step 2 : Commit** (le workflow qui l'invoque est Task 4)

```bash
git add scripts/e2e/provision-pins.sql
git commit -m "test(e2e): SQL script to provision E2E PINs from secrets (S71)"
```

---

### Task 4 : Workflow `playwright-e2e.yml` — build-in-CI + provision + artefacts

**Files:**
- Modify: `.github/workflows/playwright-e2e.yml`

**Interfaces:**
- Consumes: secrets `VITE_SUPABASE_ANON_KEY`, `E2E_PIN_ADMIN`, `E2E_PIN_CASHIER`, `V3_DEV_PG_POOLER_URL` (déjà posé).
- Produces: un run `workflow_dispatch` qui provisionne les PINs, build+sert les 2 apps, exécute les 13 specs, upload le rapport HTML + traces.

- [ ] **Step 1 : Réécrire le workflow (cron NON armé — dispatch seul)**

Remplacer `.github/workflows/playwright-e2e.yml` par :

```yaml
name: Playwright E2E

# Build-and-serve-in-CI model (S71). The job builds both apps and serves them
# on localhost via Playwright's webServer, pointing at the dev V3 backend.
# No hosted staging URLs, no Vercel.
#
# Required secrets:
#   VITE_SUPABASE_ANON_KEY   — dev V3 anon (publishable) key (build-time)
#   E2E_PIN_ADMIN            — 6-digit PIN for E2E owner  (0e2e0000-…-001)
#   E2E_PIN_CASHIER          — 6-digit PIN for E2E cashier (0e2e0000-…-002)
#   V3_DEV_PG_POOLER_URL     — pooler connection string (already set 2026-05-16)
#
# Cron is DISABLED until the suite is green (Plan 2 arms `schedule`).
on:
  workflow_dispatch:

env:
  VITE_SUPABASE_URL: https://ikcyvlovptebroadgtvd.supabase.co

jobs:
  e2e:
    name: Playwright E2E (build + serve in-CI)
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9.15

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Install Chromium browser
        run: pnpm exec playwright install --with-deps chromium

      - name: Provision E2E user PINs
        env:
          PGURL: ${{ secrets.V3_DEV_PG_POOLER_URL }}
          E2E_PIN_ADMIN: ${{ secrets.E2E_PIN_ADMIN }}
          E2E_PIN_CASHIER: ${{ secrets.E2E_PIN_CASHIER }}
        run: |
          psql "$PGURL" -v ON_ERROR_STOP=1 \
            -v adminpin="$E2E_PIN_ADMIN" -v cashpin="$E2E_PIN_CASHIER" \
            -f scripts/e2e/provision-pins.sql

      - name: Run Playwright tests
        run: pnpm exec playwright test
        env:
          CI: 'true'
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
          E2E_POS_URL: http://localhost:5173
          E2E_BO_URL: http://localhost:5174
          E2E_PIN_ADMIN: ${{ secrets.E2E_PIN_ADMIN }}
          E2E_PIN_CASHIER: ${{ secrets.E2E_PIN_CASHIER }}

      - name: Upload Playwright report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 14
```

> Note : `if: always()` (et non `failure()`) pour que le triage récupère TOUJOURS le rapport, même partiellement vert.

- [ ] **Step 2 : Valider la syntaxe YAML**

Run: `pnpm exec playwright test --list > /dev/null && python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/playwright-e2e.yml'))"`
Expected: aucune erreur (config Playwright parse + YAML valide). *(Si python indisponible, valider le YAML via `gh workflow view` après push.)*

- [ ] **Step 3 : Commit**

```bash
git add .github/workflows/playwright-e2e.yml
git commit -m "ci(e2e): build-serve-in-CI model + PIN provisioning + always-upload report (S71)"
```

---

### Task 5 : Fixture d'auth pointée sur les UUID E2E

**Files:**
- Modify: `tests/e2e/fixtures/auth.ts`

**Interfaces:**
- Produces: `SEED_USER_OWNER` / `SEED_USER_CASHIER` = UUID E2E dédiés ; `loginWithPin`/`loginPOS` inchangés dans leur logique (réparation des call-sites = Plan 2).

- [ ] **Step 1 : Remplacer les constantes d'UUID**

Dans `tests/e2e/fixtures/auth.ts`, remplacer les lignes 14-17 :

```ts
// Seed user IDs — dedicated E2E accounts (S71, migration 20260710000141).
// NOT the legacy 000…001/002 demo accounts: E2E users are isolated so nightly
// PIN resets never touch real staff. PINs are provisioned from CI secrets.
export const SEED_USER_OWNER   = '0e2e0000-0000-4000-a000-000000000001';
export const SEED_USER_CASHIER = '0e2e0000-0000-4000-a000-000000000002';
```

- [ ] **Step 2 : Vérifier la compilation TS des fixtures**

Run: `pnpm exec tsc --noEmit -p tests/e2e/tsconfig.json 2>/dev/null || pnpm exec playwright test --list > /dev/null`
Expected: pas d'erreur TS sur `auth.ts` (si pas de tsconfig dédié aux tests, `--list` compile la config et échoue seulement sur une vraie erreur de type).

- [ ] **Step 3 : Commit**

```bash
git add tests/e2e/fixtures/auth.ts
git commit -m "test(e2e): point auth fixture at dedicated E2E user UUIDs (S71)"
```

---

### Task 6 : Triage local (agent) + rapport

**Files:**
- Create: `docs/workplan/plans/2026-07-09-session-71-e2e-triage.md`

**Interfaces:**
- Consumes: users E2E seedés (Task 2), config webServer (Task 1), auth fixture (Task 5).
- Produces: un rapport listant, **par spec**, le verdict (PASS/FAIL) et la cause d'échec observée — matière première du Plan 2.
- **MCP requis** (lead-executed) : poser un PIN jetable + récupérer l'anon key.

- [ ] **Step 1 : Poser un PIN jetable sur les 2 users E2E (MCP)**

Lead exécute `mcp__claude_ai_Supabase__execute_sql` :
```sql
UPDATE public.user_profiles SET pin_hash = hash_pin('424242'), failed_login_attempts=0, locked_until=NULL
 WHERE id IN ('0e2e0000-0000-4000-a000-000000000001','0e2e0000-0000-4000-a000-000000000002');
```
> `424242` est un PIN de triage local **jetable** (jamais commité, jamais le secret CI).

- [ ] **Step 2 : Récupérer l'anon key du projet dev**

Lead récupère la clé publishable/anon via l'outil MCP Supabase disponible (`get_publishable_keys` / équivalent). Noter la valeur pour l'injecter en env local (ne PAS la committer).

- [ ] **Step 3 : Lancer la suite en local contre dev V3**

Run (PowerShell, depuis la racine) :
```
$env:VITE_SUPABASE_URL="https://ikcyvlovptebroadgtvd.supabase.co"; `
$env:VITE_SUPABASE_ANON_KEY="<anon-key>"; `
$env:E2E_PIN_ADMIN="424242"; $env:E2E_PIN_CASHIER="424242"; `
$env:E2E_POS_URL="http://localhost:5173"; $env:E2E_BO_URL="http://localhost:5174"; `
pnpm exec playwright test --reporter=list --retries=0
```
Expected: la config build+sert les 2 apps puis exécute les 13 specs. La plupart **échoueront** (specs S13/S21 périmées) — c'est le résultat attendu du triage, pas un échec du plan.

> Si le build/preview ne démarre pas : vérifier que `pnpm --filter @breakery/app-pos build` puis `... preview --port 5173` fonctionne à la main, et que l'anon key est correcte (login → EF `auth-verify-pin`).

- [ ] **Step 4 : Consigner le rapport de triage**

Créer `docs/workplan/plans/2026-07-09-session-71-e2e-triage.md` avec, pour **chacune des 13 specs** : verdict PASS/FAIL, et pour les FAIL la 1ʳᵉ cause observée (sélecteur manquant, timeout login, flux UI changé, assert absolu obsolète, dépendance données). Table minimale :

```markdown
| Spec | Projet | Verdict | Cause d'échec (1ʳᵉ) | Piste de réparation |
|------|--------|---------|---------------------|---------------------|
| complete-order | pos | FAIL | … | … |
| … | … | … | … | … |
```

- [ ] **Step 5 : Commit**

```bash
git add docs/workplan/plans/2026-07-09-session-71-e2e-triage.md
git commit -m "docs(s71): E2E suite triage report (pass/fail matrix) (S71)"
```

---

### Task 7 : `STAGING_SETUP.md` — nouveau modèle build-in-CI

**Files:**
- Modify: `.github/workflows/STAGING_SETUP.md`

**Interfaces:**
- Produces: doc de provisioning à jour (build-in-CI, plus d'URLs hébergées) + la liste exacte des secrets à poser par l'utilisateur.

- [ ] **Step 1 : Réécrire la section E2E**

Remplacer la section « Secrets required by `playwright-e2e.yml` » et son tableau de statut par le modèle build-in-CI. Contenu à insérer :

```markdown
## Secrets required by `playwright-e2e.yml` (S71 build-in-CI model)

Le nightly build + sert POS/BO en localhost dans le job (pas d'URL hébergée).
Il ne reste que 3 secrets à poser (le 4e est déjà là) :

```bash
# Dev V3 anon (publishable) key — Dashboard → Settings → API → anon (public)
gh secret set VITE_SUPABASE_ANON_KEY --body "<anon-key>"

# 6-digit PIN de l'utilisateur E2E owner  (user_profiles 0e2e0000-…-001)
gh secret set E2E_PIN_ADMIN --body "<6-digit-pin>"

# 6-digit PIN de l'utilisateur E2E cashier (user_profiles 0e2e0000-…-002)
gh secret set E2E_PIN_CASHIER --body "<6-digit-pin>"

# Déjà posé (2026-05-16) — connexion pooler pour le provisioning des PINs :
#   V3_DEV_PG_POOLER_URL
```

`VITE_SUPABASE_URL` est public (`https://ikcyvlovptebroadgtvd.supabase.co`) et
codé en clair dans le workflow — pas un secret. Les anciens secrets
`STAGING_POS_URL` / `STAGING_BO_URL` / `E2E_KIOSK_JWT` ne sont plus requis.
```

- [ ] **Step 2 : Commit**

```bash
git add .github/workflows/STAGING_SETUP.md
git commit -m "docs(e2e): document build-in-CI provisioning model (S71)"
```

---

## Handoff / Definition of Done (Plan 1)

À la fin de ce plan :
1. `pnpm exec playwright test --list` liste 13 specs (s44 câblée) ; la config build+sert les 2 apps.
2. Les 2 users E2E existent sur dev V3 et remontent dans `list_login_users_v1`.
3. Le triage local a produit `2026-07-09-session-71-e2e-triage.md` (matrice pass/fail réelle).
4. **Action utilisateur** : poser les 3 secrets (`VITE_SUPABASE_ANON_KEY`, `E2E_PIN_ADMIN`, `E2E_PIN_CASHIER`) puis déclencher `workflow_dispatch` → confirme la chaîne CI (provision → build → serve → run) et upload le rapport.
5. **Plan 2** (réparation spec-par-spec + delta-seeding + armement cron) est écrit à partir du rapport de triage.

**Le cron n'est PAS armé ici** — il le sera au closeout du Plan 2, quand 13/13 sont vertes.

## Self-Review (couverture du spec)

- Spec §5.1 (webServer + s44) → Task 1. ✅
- Spec §5.2 (workflow cron+provision) → Task 4 (cron différé Plan 2, décision de structure validée). ✅
- Spec §5.3 (migration seed users E2E) → Task 2. ✅
- Spec §5.4 (provisioning PIN service-role/pooler) → Task 3 (script) + Task 4 (step). Résolu : `reset_user_pin_v1` inappelable en service-role → UPDATE direct via pooler + `hash_pin`. ✅
- Spec §5.5 (`fixtures/seed.ts` self-seeding) → **différé Plan 2** (utilisé par les specs réparées ; hors périmètre « runnable + triage »). `auth.ts` UUID → Task 5. ✅
- Spec §5.6 (réécriture delta des specs) → **Plan 2** (piloté par le triage). ✅
- Spec §7 (secrets utilisateur) → Task 7. ✅
- Spec §2/§8 DoD 13/13 + cron → atteint via Plan 1 (runnable+triage) puis Plan 2 (réparation+cron). ✅
- Money-path intouchée (§8) → Global Constraints ; aucune tâche ne touche un RPC money-path. ✅
