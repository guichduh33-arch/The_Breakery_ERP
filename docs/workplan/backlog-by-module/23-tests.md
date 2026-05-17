# Travail — Tests

> Last updated: 2026-05-17
> Référence : [`../09-testing/`](../09-testing/) (`01-test-strategy.md`, `02-unit-tests.md`)
> Sources audit : `docs/audit/04-reports-testing-audit.md` §Test Coverage Assessment + Recommendations, `docs/audit/03-code-quality-schema-audit.md` §B / §A8, `CURRENT_STATE.md` Known Issues, `CLAUDE.md` Pitfalls

## Objectifs du module

1. Atteindre 70 % lines / 60 % branches sur les modules critiques (POS, payments, accounting, inventory) — cible alignée `CURRENT_STATE.md` T7.
2. Réparer ou isoler les tests pré-existants en échec — cible : `npx vitest run` retourne 0 failure (vs 5-9 actuels documenté).
3. Combler les zones zéro-coverage : 87 composants reports, route guards, layouts — cible : smoke test minimum par fichier.
4. Mettre en place des tests E2E sur les 3 flows critiques (POS sale full + split, accounting JE auto, KDS dispatch) — cible : 1 suite Playwright qui tourne en CI.
5. Stabiliser la pipeline CI : tests sur chaque PR, parallélisation, artefacts coverage — cible : feedback < 5 min par PR.

---

## Tâches

### TASK-23-001 — Réparer les 9 tests Edge Functions cassés [P1] [OBSOLETE]
**Status note (2026-05-14)** : V2-only task — V3 has no `authService.test.ts` (V3 PIN auth lives in `apps/pos/src/features/auth/` + EF `auth-verify-pin`). V3 inventory/auth EF tests now run against the cloud staging project per CLAUDE.md "Targeted iteration" guidance. The specific 9-failure ticket does not survive translation.
**Contexte** : `CLAUDE.md` Pitfalls — *"9 pre-existing test failures (1 file: authService.test.ts) — Edge Function tests requiring live Supabase, known, not regressions"* + `CURRENT_STATE.md` Known Issues *"5 pre-existing test failures in 3 files"*. Discrepancy entre les 2 sources documentée dans audit `06-documentation-audit.md` §Inaccuracies.
**Critère d'acceptation** :
- [ ] Audit complet : recenser exactement les fichiers en échec aujourd'hui (`npx vitest run` + capture log)
- [ ] Pour `authService.test.ts` : mock complet de `supabase.functions.invoke` au lieu d'appel live
- [ ] `npx vitest run` retourne 0 failure
- [ ] CLAUDE.md + CURRENT_STATE.md mis à jour avec le nombre réel
**Fichiers concernés** : `src/services/__tests__/authService.test.ts`, autres fichiers à identifier
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : tests cachent un bug réel — vérifier que mocks reflètent la vraie signature Edge Function
**Notes** : prioritaire pour libérer la CI (TASK-23-008)

### TASK-23-002 — Smoke tests pour les 87 composants reports [P1] [TODO]
**Status note (2026-05-14)** : Phase 6.A reports cascade shipped 4 V3 report pages (`ProfitLossPage`, `BalanceSheetPage`, `CashFlowPage`, `BasketAnalysisPage`) but the V2 "87 untested report components" assumption doesn't transfer — V3 reports surface is much smaller. Uncertain — manual review needed to redefine the smoke-test sweep against V3 `apps/backoffice/src/pages/reports/`.
**Contexte** : `docs/audit/04-reports-testing-audit.md` §Recommendations — *"Priority: Add smoke tests for report tabs. At minimum, render each tab with mocked data and verify it doesn't crash. This covers the 87 untested components with ~87 simple tests."*
**Critère d'acceptation** :
- [ ] Helper `renderReportTab(Component, mockData)` qui fournit context (QueryClient, theme, router) + mocks Supabase
- [ ] 87 tests (ou groupés par 5-10) qui montent chaque tab et vérifient `expect(container).not.toBeEmpty()` + absence d'erreur console
- [ ] Tests organisés par catégorie : `src/pages/reports/components/__tests__/`
- [ ] Vitest coverage report montre coverage > 50 % sur `pages/reports/components/`
**Fichiers concernés** : `src/pages/reports/components/__tests__/*.test.tsx`, helper test
**Dépend de** : TASK-23-001
**Estimation** : `XL`
**Risques** : 87 tests = lourd à écrire one-by-one — générer via script template puis ajustement manuel
**Notes** : décomposer en 6 sous-tâches L (une par catégorie de rapport)

### TASK-23-003 — Tests E2E flows critiques (Playwright) [P1] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 6.C. V3 evidence: `playwright.config.ts` at repo root + 3 specs `tests/e2e/{complete-order,opname-finalize,po-receive}.spec.ts` + `@playwright/test ^1.49.1` dev dep (D-W6-6C-06). NOTE: CI runner job deferred (D-W6-6C-05) — see TASK-23-008. Commit `bdf21aa`.
**Contexte** : `docs/audit/04-reports-testing-audit.md` §Quality Assessment Weaknesses — *"No integration tests (component + service together)."* Pas de Playwright dans le repo aujourd'hui.
**Critère d'acceptation** :
- [ ] Setup Playwright (`@playwright/test`) + config base URL dev + supabase test instance
- [ ] Flow A — POS sale complete : login PIN → ajouter 3 produits → checkout cash → vérifier order créé + JE auto
- [ ] Flow B — Split payment : login → ajouter produits → split 50% cash + 50% card → vérifier 2 order_payments + balance OK
- [ ] Flow C — KDS dispatch : POS create order → KDS reçoit → marquer ready → POS reflète statut
- [ ] CI run via GitHub Actions, vidéo capture en cas d'échec
**Fichiers concernés** : `e2e/`, `playwright.config.ts`, `.github/workflows/e2e.yml`
**Dépend de** : TASK-23-001
**Estimation** : `XL`
**Risques** : flakiness Playwright sur Realtime — utiliser `expect.poll` avec timeout généreux
**Notes** : décomposer : (a) setup + Flow A, (b) Flow B, (c) Flow C

### TASK-23-004 — Tests composants critiques POS [P1] [TODO]
**Status note (2026-05-14)** : V3 has co-located `__tests__/` directories under `apps/pos/src/features/{cart,payment,kds,...}/` but no formal coverage threshold has been hit on these (the spec asked > 70% on `src/components/pos/` which is the V2 path). Genuinely undone — reframe against V3 feature folder layout.
**Contexte** : `docs/audit/04-reports-testing-audit.md` §Test Coverage by Module — *"Components: 6 files tested (Low). 87 report files untested."* En dehors des reports, modales POS critiques aussi peu testées (Cart, PaymentModal, KDS cards).
**Critère d'acceptation** :
- [ ] `Cart.tsx` : tests rendering avec items, locked items, totaux, modifications quantité
- [ ] `PaymentModal.tsx` : tests cash / card / split / cancel flow
- [ ] `KDSOrderCard.tsx` : tests états (new, preparing, ready), actions, urgence
- [ ] `CartItemRow.tsx` : interactions clavier (post TASK-22-004)
- [ ] Coverage > 70 % sur `src/components/pos/` et `src/components/kds/`
**Fichiers concernés** : `src/components/pos/__tests__/`, `src/components/kds/__tests__/`
**Dépend de** : TASK-23-001
**Estimation** : `L`
**Risques** : —
**Notes** : utiliser `@testing-library/react` + `userEvent`

### TASK-23-005 — Tests route guards + layouts [P2] [TODO]
**Status note (2026-05-14)** : V3 has `BackOfficeLayout` but the V2 `POSAccessGuard`/`BackOfficeAccessGuard`/`PermissionGuard`/`MobileLayout` components don't map 1:1 (kiosk-JWT shape from Phase 1.B is a different gate model). Uncertain — manual review needed to redefine target guards against V3 routing.
**Contexte** : `docs/audit/04-reports-testing-audit.md` §Zero Coverage Modules — *"Route guards (no tests for POSAccessGuard, BackOfficeAccessGuard). Layouts (no tests)."*
**Critère d'acceptation** :
- [ ] Tests `POSAccessGuard` : redirect si pas de permission, render si ok
- [ ] Tests `BackOfficeAccessGuard` : idem
- [ ] Tests `PermissionGuard` (déjà partiellement testé ?) : default deny, allow si role/permission match
- [ ] Tests `BackOfficeLayout` smoke + toggle sidebar mobile
- [ ] Tests `MobileLayout` smoke + bottom nav
**Fichiers concernés** : `src/components/auth/__tests__/POSAccessGuard.test.tsx`, etc.
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : mocks authStore complexes — réutiliser fixtures existantes
**Notes** : —

### TASK-23-006 — Test data fixtures organization [P2] [TODO]
**Status note (2026-05-14)** : No `src/test/fixtures/` directory established in V3 ; Session 13 tests inline their mocks per-file. Doc `docs/reference/09-testing/03-fixtures-and-mocks.md` not created. Genuinely undone.
**Contexte** : Pas de pattern unifié vu dans les tests audités. Mocks répétés dans chaque fichier (objets `IProduct`, `IOrder` reconstruits manuellement).
**Critère d'acceptation** :
- [ ] Dossier `src/test/fixtures/` avec : `products.ts`, `orders.ts`, `customers.ts`, `users.ts`, `accounting.ts`
- [ ] Factory functions : `createMockProduct(overrides?)`, `createMockOrder(overrides?)`
- [ ] Migration de 10 fichiers tests existants vers fixtures
- [ ] Doc test conventions : `docs/reference/09-testing/03-fixtures-and-mocks.md`
**Fichiers concernés** : `src/test/fixtures/*.ts`, doc
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : —
**Notes** : pattern aligné avec `MSW` (si introduit plus tard)

### TASK-23-007 — Coverage cible par module [P2] [TODO]
**Status note (2026-05-14)** : No per-module coverage thresholds wired into `vitest.config.ts` or CI in Session 13. The CI workflow (`.github/workflows/ci.yml`) uploads coverage artifacts but doesn't enforce gates. Genuinely undone.
**Contexte** : `CURRENT_STATE.md` T7 — *"Test coverage 60% → 70%"*. Cible globale floue, manque déclinaison par module.
**Critère d'acceptation** :
- [ ] Définir cibles par module dans `vitest.config.ts` ou doc :
  - POS / payments / accounting : 80 % lines, 70 % branches
  - inventory / purchasing / customers : 70 % lines, 60 % branches
  - reports / settings / mobile : 60 % lines, 50 % branches
- [ ] Script `npm run test:coverage` qui génère report HTML
- [ ] CI échoue si coverage tombe sous seuil (configurable par module via `c8` ou `v8` provider)
**Fichiers concernés** : `vitest.config.ts`, `package.json`
**Dépend de** : TASK-23-002, TASK-23-004
**Estimation** : `M`
**Risques** : seuil trop strict bloque dev — phase intro tolérante (warn only) avant enforce
**Notes** : —

### TASK-23-008 — CI : tests sur chaque PR [P1] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 0.2. V3 evidence: `.github/workflows/ci.yml` runs `pnpm install --frozen-lockfile` → has_permission lock guard → lint → typecheck → `pnpm test` → `pnpm build` on every PR to `master/main`, plus a separate `supabase-tests` job for pgTAP/integration. NOTE: Playwright E2E is NOT yet wired into CI (D-W6-6C-05 open follow-up). Commit `bdf21aa`.
**Status note (2026-05-17)** : S16 update — Le `supabase-tests` Docker job a été **retiré** (Docker retraite locale 2026-05-14 + job cassé sur GH Actions runners) et remplacé par un cron nightly. Voir TASK-23-012 pour pgTAP nightly. Playwright E2E toujours pas en CI (D-W6-6C-05 reste ouvert).
**Contexte** : Pas de `.github/workflows/` mentionné dans audit Operations §5.2. Tests pas en CI = régressions passent en review humaine.
**Critère d'acceptation** :
- [ ] `.github/workflows/ci.yml` qui : `npm ci` → `npm run lint` → `npx vitest run` sur chaque PR
- [ ] Statut required check sur la branche `main` (settings GitHub)
- [ ] Cache `node_modules` pour temps < 5 min
- [ ] Annotations PR : tests failed → commentaire automatique avec lien vers job
**Fichiers concernés** : `.github/workflows/ci.yml`, settings repo (manuel)
**Dépend de** : TASK-23-001 (sinon CI rouge perpétuelle)
**Estimation** : `M`
**Risques** : —
**Notes** : prioritaire avant TASK-23-002 / 23-003 sinon coverage non vérifié

### TASK-23-009 — Test parallelization [P3] [TODO]
**Status note (2026-05-14)** : Session 13 CI (`.github/workflows/ci.yml`) runs single-shard `pnpm test`. No `--shard` matrix configured. Genuinely undone — low priority while suite runtime remains acceptable.
**Contexte** : `npx vitest run` actuellement sur ~1770 tests (CLAUDE.md). Si CI séquentiel = > 2 min. Vitest supporte `--shard` pour parallélisation.
**Critère d'acceptation** :
- [ ] Workflow CI utilise matrix `shard: [1/4, 2/4, 3/4, 4/4]` pour splitter
- [ ] Total runtime < 90 s
- [ ] Coverage merge : merger les rapports des 4 shards via `nyc merge` ou équivalent
**Fichiers concernés** : `.github/workflows/ci.yml`
**Dépend de** : TASK-23-008
**Estimation** : `S`
**Risques** : tests dépendant ordre (rare en vitest) — détecter via `--randomize`
**Notes** : —

### TASK-23-010 — Visual regression tests [P3] [TODO]
**Status note (2026-05-14)** : No `tests/e2e/visual/` snapshots configured ; Phase 6.C Playwright work covered functional E2E only (3 specs). Genuinely undone — would build on top of the now-present Playwright setup.
**Contexte** : `docs/audit/04-reports-testing-audit.md` §Quality Assessment Weaknesses — *"No visual regression tests for charts."* TASK-22-001 (purge couleurs) a aussi besoin de visual diff pour valider absence de régression.
**Critère d'acceptation** :
- [ ] Outil choisi : Playwright screenshots + Percy / Chromatic OU Percy seul
- [ ] Snapshots des 10 surfaces critiques : POS, KDS, Dashboard, Reports overview, Login, Checkout, etc.
- [ ] Run sur chaque PR, diff bloquant si > 0.1 % pixel diff non approuvé
**Fichiers concernés** : `e2e/visual/`, config outil
**Dépend de** : TASK-23-003 (Playwright dispo)
**Estimation** : `L`
**Risques** : coût SaaS (Percy ~$149/mois) — alternative open-source Playwright snapshots interne
**Notes** : reporter si budget serré

### TASK-23-011 — Performance benchmarks [P3] [TODO]
**Status note (2026-05-14)** : No `vitest bench` files (`__bench__/*.bench.ts`) in Session 13. Genuinely undone.
**Contexte** : `docs/audit/04-reports-testing-audit.md` §Performance — *"Some reports (e.g., getProductPerformance) fetch all order_items in range and aggregate client-side — could be slow for large date ranges."* Pas de bench aujourd'hui.
**Critère d'acceptation** :
- [ ] Vitest bench (`vitest bench`) sur fonctions critiques : `cartCalculations`, `accountingEngine.postSaleJE`, `getProductPerformance`
- [ ] Snapshot baseline committée
- [ ] CI alerte si régression > 20 % vs baseline
**Fichiers concernés** : `src/**/__bench__/*.bench.ts`
**Dépend de** : TASK-23-008
**Estimation** : `M`
**Risques** : noise CI runners variables → seuil tolérant
**Notes** : —

### TASK-23-012 — pgTAP nightly cron CI [P1] [DONE]
**Status note (2026-05-17)** : DONE — S16 livré. Résout DEV-S15-CI-01 (medium). Le job `supabase-tests` Docker dans `.github/workflows/ci.yml` était cassé depuis la retraite Docker locale 2026-05-14 (les runners GH Actions n'ont pas le stack Supabase local). S16 a (a) supprimé ce job du PR-time CI et (b) ajouté `.github/workflows/pgtap-nightly.yml` qui tourne quotidiennement contre le projet cloud V3 dev (`ikcyvlovptebroadgtvd`) via cron `0 19 * * *` UTC (3am Asia/Makassar).
**Contexte** : Sans Docker local, le pgTAP ne peut plus tourner en pre-commit ou PR-time. La régression silencieuse sur les RPCs DB devient possible si on n'a pas de gate.
**Critère d'acceptation** :
- [x] Suppression du job `supabase-tests` cassé de `.github/workflows/ci.yml`
- [x] Création `.github/workflows/pgtap-nightly.yml` avec cron quotidien
- [x] Smoke test `supabase/tests/ci_smoke.test.sql` pour vérifier connectivité
- [x] Exécute la suite pgTAP existante (`supabase/tests/*.test.sql`) contre `ikcyvlovptebroadgtvd`
- [x] Notifie sur échec via GH Actions native (issue auto / email)
**Fichiers concernés** : `.github/workflows/ci.yml` (drop job), `.github/workflows/pgtap-nightly.yml` (CREATE), `supabase/tests/ci_smoke.test.sql` (CREATE).
**Dépend de** : aucune.
**Estimation** : S (livré)
**Risques** : pas de gate PR-time (DEV-S16-1.A-01 informational) — un PR cassant un RPC ne sera détecté que ~24h plus tard. À envisager un gate PR-time via supabase branching pour un sous-ensemble critique de pgTAP (future).
**Notes** : INDEX S16 `docs/workplan/plans/2026-05-16-session-16-INDEX.md`.

---

## Synthèse priorité

| Priorité | Tâches |
|----------|--------|
| P1 | 23-001, 23-002, 23-003, 23-004, 23-008, 23-012 |
| P2 | 23-005, 23-006, 23-007 |
| P3 | 23-009, 23-010, 23-011 |
