# S71 — E2E nightly (Playwright) : re-dégeler et fiabiliser la suite

- **Date** : 2026-07-09
- **Session** : S71 (chantier Vague 2)
- **Branche** : `swarm/session-71`
- **Statut** : design validé (brainstorming) — en attente relecture utilisateur avant plan

## 1. Problème

La suite E2E Playwright (`tests/e2e/`, 13 specs, projets `pos` + `backoffice`) existe
mais son **cron nightly est désactivé** (`playwright-e2e.yml` sur `workflow_dispatch`
seul). Deux blocages historiques, documentés en tête du workflow et dans
`STAGING_SETUP.md` :

1. **Aucun frontend POS/BO hébergé** (les secrets `STAGING_POS_URL`/`STAGING_BO_URL`
   pointent sur des URLs qui n'existent pas).
2. **Aucun secret E2E provisionné** (`E2E_PIN_CASHIER`, `E2E_PIN_ADMIN`, anon key…).

Conséquence : zéro filet de non-régression E2E, alors que le workplan a officialisé
« le dev est le staging » (projet Supabase dev V3 `ikcyvlovptebroadgtvd`). En prime,
`s44-money-path.spec.ts` existe mais **n'est câblée dans aucun `testMatch`** de la
config → spec morte.

## 2. Objectif (Definition of Done)

- **13/13 specs vertes** contre le backend dev V3, prouvées par **un run
  `workflow_dispatch`** déclenché après provisioning des secrets, puis **cron ré-armé**
  (22:00 UTC).
- `s44-money-path.spec.ts` câblée.
- Specs mutantes rendues **déterministes** (self-seeding delta-based) — résistantes à
  la concurrence des sessions swarm qui mutent le même dev.
- `STAGING_SETUP.md` mis à jour pour le nouveau modèle (build-in-CI, plus d'URLs
  hébergées).
- `pnpm typecheck/build/test` verts ; types no-drift ; migration de seed revue
  pattern-guardian.

**Hors périmètre (YAGNI)** : pas de Vercel / `staging-deploy.yml`, pas de branche
Supabase éphémère, pas de reset destructif du dev, pas de nouvelle couverture au-delà
des 13 specs existantes.

## 3. Décisions de cadrage (brainstorming)

| Axe | Décision | Rejeté |
|---|---|---|
| Frontend | **Build + serve dans le job CI** contre le backend dev V3 | URLs hébergées Vercel (infra à maintenir, ~6 secrets, coût) |
| Périmètre | **13 specs vertes** (câbler s44 + déterminisme) | Socle smoke seul ; rebranchement minimal |
| Isolation DB | **Self-seeding delta-based, non destructif** ; caisse dédiée pour les singletons | Branche éphémère (lourd) ; reset fixture (destructif sur dev partagé) |
| Auth/secrets | **Users E2E dédiés** (seed idempotent) + PINs posés par l'utilisateur via 3 secrets ; preuve par `workflow_dispatch` vert | Provisioning différé (moins de garantie) |
| Identité des users E2E | **UUID E2E dédiés** (pas de réutilisation de `…001/…002`) pour ne toucher aucun compte staff existant ; fixture `auth.ts` mis à jour | Réutiliser `…001/…002` avec marqueur `is_test` (risque de hijack de comptes réels) |

## 4. Architecture

Nightly **auto-contenu**. Aucune infra hors GitHub Actions + le backend dev V3 (déjà là).

```
GHA job (ubuntu-latest, on: schedule cron '0 22 * * *' + workflow_dispatch)
 ├─ checkout · pnpm 9.15 · node 20 · pnpm install --frozen-lockfile
 ├─ playwright install --with-deps chromium
 ├─ [step] provision-e2e-pins  (service-role, idempotent)
 │       └─ pose les PINs des 2 users E2E depuis E2E_PIN_* → pin_hash à jour
 ├─ playwright test
 │   ├─ webServer#1 : build+preview POS → http://localhost:5173  ─┐ VITE_SUPABASE_URL
 │   ├─ webServer#2 : build+preview BO  → http://localhost:5174  ─┤ VITE_SUPABASE_ANON_KEY
 │   └─ projets pos/backoffice, sériel, retries 2                 ─┘→ dev V3
 │        auth : loginWithPin (UI) → auth-verify-pin EF (PIN-JWT) → dev V3
 └─ upload playwright-report/ + traces  (if failure, 7 j)
```

## 5. Composants & changements

### 5.1 `playwright.config.ts` (racine)
- Ajouter **`webServer: [...]`** à 2 entrées :
  - POS : `command: 'pnpm --filter @breakery/pos build && pnpm --filter @breakery/pos preview --port 5173 --strictPort'`, `url: 'http://localhost:5173'`, `reuseExistingServer: !process.env.CI`, `timeout: 180_000`.
  - BO : idem sur `5174`.
  - Env de build (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) hérité du job.
- **Câbler `s44-money-path.spec.ts`** dans le `testMatch` du projet `pos`.
- Conserver `fullyParallel:false`, `workers:1`, `retries:2` (état DB partagé → sériel).
- `baseURL` des projets inchangés (localhost 5173/5174 via `E2E_POS_URL`/`E2E_BO_URL`
  qui, en CI, pointeront sur localhost et non plus des URLs hébergées).

> ⚠️ À confirmer au plan : nom exact du script `preview` par app (`vite preview`) et
> que le build accepte l'injection env `VITE_*` (build-time). Vérifier les ports par
> défaut des 2 apps (`5173`/`5174`).

### 5.2 `playwright-e2e.yml`
- **Restaurer `on: schedule: - cron: '0 22 * * *'`** + garder `workflow_dispatch`.
- Retirer l'en-tête « NOT SET UP / DISABLED ».
- Nouvelle étape **`provision-e2e-pins`** avant `playwright test`.
- Env du run : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `E2E_POS_URL=http://localhost:5173`,
  `E2E_BO_URL=http://localhost:5174`, `E2E_PIN_CASHIER`, `E2E_PIN_ADMIN`,
  `SUPABASE_SERVICE_ROLE` (déjà présent), `CI=true`.

### 5.3 Migration de seed users E2E — `20260710000141`
- **Idempotente** (`ON CONFLICT DO NOTHING`), crée 2 `user_profiles` E2E dédiés :
  - E2E owner (rôle owner/admin) — UUID dédié documenté.
  - E2E cashier (rôle cashier) — UUID dédié documenté.
- Marqueur explicite (email `e2e+owner@…`/`e2e+cashier@…` ou colonne `is_test` si
  elle existe — sinon marqueur par convention d'email) + `is_active=true` pour qu'ils
  remontent dans `list_login_users_v1` (donc cliquables dans le user-picker).
- `pin_hash` initial = **placeholder invalide** (jamais un PIN réel en clair dans le
  repo) ; le PIN réel est posé par la step CI (§5.4).
- Respect du trio S20 / hygiène migration (pas de `BEGIN/COMMIT`, numérotation
  monotone, types regen si le schéma bouge — a priori aucune nouvelle colonne).

> ⚠️ À confirmer au plan via MCP `execute_sql` : structure exacte de `user_profiles`
> (colonnes NOT NULL : `pin_hash`, rôle, nom…), existence éventuelle des UUID choisis,
> et ce que `list_login_users_v1` exige pour retourner un user.

### 5.4 Provisioning PIN (step CI + script)
- Script Node dédié (`scripts/e2e/provision-pins.ts` ou `tests/e2e/provision-pins.ts`)
  exécuté par la step CI avec `SUPABASE_SERVICE_ROLE` + `E2E_PIN_*`.
- Pose le `pin_hash` des 2 users E2E **depuis les secrets**, idempotent, avant le run.
- Primitif exact **à confirmer au plan** : `reset_user_pin_v1(...)` (si son corps hashe
  côté serveur) **vs** update service-role direct avec `crypt(pin, gen_salt('bf'))`
  (pgcrypto, compatible bcrypt vérifié par l'EF `auth-verify-pin`). Le choix doit
  produire un hash que `auth-verify-pin` valide.
- Bénéfice : la valeur du PIN **ne vit jamais dans le repo** ; rotation = changer le
  secret.

### 5.5 Fixtures self-seeding — `tests/e2e/fixtures/seed.ts` (nouveau)
- Helpers réutilisables :
  - `seedUniqueProduct(page|api)` → produit à SKU unique (`E2E-<runId>-<ts>`).
  - `openE2EShift(...)` → ouvre un shift sur une **caisse `register` dédiée E2E** pour
    isoler les flux singleton (clôture/Z-report) de la concurrence.
  - `uniqueTag()` → suffixe run-id + timestamp (fourni par une var d'env de run, ex.
    `GITHUB_RUN_ID`, ou un identifiant stable généré côté fixture — **pas** de
    `Date.now()` non-déterministe côté script de plan).
- `fixtures/auth.ts` : remplacer `SEED_USER_OWNER`/`SEED_USER_CASHIER` par les UUID
  E2E dédiés.

### 5.6 Réécriture ciblée des specs mutantes → asserts delta
Specs concernées : `complete-order`, `pos-login-order`, `po-receive`,
`opname-finalize`, `s43-pos-audit-fixes`, `s44-money-path`, `stock-inventory-pages`
(et vérifier les autres). Principe : chaque spec **capture un état avant**, agit sur
**ses propres entités uniques**, **assert le delta** — jamais un total absolu ni le
premier élément d'une liste partagée. Les specs de lecture pure (`s40-reports`, etc.)
sont ajustées seulement si elles supposent un état figé.

## 6. Flakiness & artefacts
- Sériel (`workers:1`) + `retries:2`.
- `trace:'on-first-retry'`, `video:'retain-on-failure'`, `screenshot:'only-on-failure'`
  (déjà en place) ; upload `playwright-report/` + traces en artefact 7 j **on failure**.
- `timeout-minutes: 30` sur le job.

## 7. Secrets à poser par l'utilisateur (une fois)
Commandes `gh secret set` fournies à la clôture du plan. Minimum :
- `VITE_SUPABASE_ANON_KEY` (ou réutiliser `SUPABASE_ANON_KEY_STAGING` s'il est posé).
- `E2E_PIN_CASHIER` (6 chiffres, choisi par l'utilisateur).
- `E2E_PIN_ADMIN` (6 chiffres, choisi par l'utilisateur).
- `VITE_SUPABASE_URL` = `https://ikcyvlovptebroadgtvd.supabase.co` (public, peut être en clair dans le YAML plutôt qu'en secret).
- `SUPABASE_SERVICE_ROLE` : **déjà présent** (depuis 2026-06-27).

## 8. Risques & mitigations
- **Concurrence des sessions swarm sur dev** → asserts delta + entités uniques + caisse
  E2E dédiée (§5.5/5.6).
- **Build-time env non injecté** → vérifier au plan que `VITE_*` est lu au build des 2
  apps ; sinon step de build explicite avec env avant `preview`.
- **Hash PIN incompatible** → §5.4 impose un hash validé par `auth-verify-pin` (test de
  bout en bout dans le run de preuve).
- **Rate-limit auth-verify-pin** sur les logins répétés → vérifier que le sériel +
  users E2E dédiés ne déclenchent pas le lockout `_verify_pin_with_lockout` (Finding
  F-1 : le lockout durable vient du chemin EF).
- **Money-path intouchée** : aucune modification de v17/v11/v5/fire_v4/EF — la session
  est **test-only + CI + une migration de seed additive**.

## 9. Livrables
1. `playwright.config.ts` (webServer + s44).
2. `.github/workflows/playwright-e2e.yml` (cron + step provision-pins).
3. `supabase/migrations/20260710000141_seed_e2e_users.sql`.
4. `scripts/e2e/provision-pins.ts` (ou emplacement équivalent).
5. `tests/e2e/fixtures/seed.ts` + `auth.ts` mis à jour.
6. Specs mutantes réécrites en delta + `s44-money-path` câblée.
7. `STAGING_SETUP.md` actualisé.
8. INDEX de session `docs/workplan/plans/2026-07-09-session-71-INDEX.md` au closeout.
