# Session 15 — INDEX (Bakery Production : F6 + F5 + Recipe pro)

**Date:** 2026-05-15
**Branch:** `swarm/session-15` (from `d7d60d5` master, after Session 14 + CI fix `9d98f61`)
**Spec:** [`../specs/2026-05-15-session-15-spec.md`](../specs/2026-05-15-session-15-spec.md)
**Migration block reserved:** `20260519000001..210`

---

## 1. Goal global

Combler le gap fonctionnel bakery (audit produit P0 §Critical-3) : **F6 sub-recipes** (recettes composées récursives + cost cascade + déduction stock récursive) + **F5 yield tracking** (expected vs actual + JE actual) + **recipe pro features** (versioning, batch production, scheduling, ergonomic UX). Plus, en P3, margin alerts + boulanger's percentages + allergens structurés.

**Total phases exécutables : 14** (Wave 0..6).
**Effort estimé : 55h parallel, 80h solo.**

Session 14 a déjà livré l'UX product/inventory ; F1 expiry est clos depuis Session 13. Session 15 = **mécanique métier bakery uniquement**.

---

## 2. Architecture en vagues

```
Wave 0 (planning, no code)
   ├── Phase 0.1 Spec + INDEX + branch + workplan update (CE DOC)
   └── Phase 0.2 Wave 0 commit + Wave 1 dispatch
        │
        ▼
Wave 1 (F6 sub-recipes — DB + domain + tests) — 3 phases parallèles
   ├── Phase 1.A DB : anti-cycle trigger + calculate_recipe_cost_v1 + recipe_versions + record_production_v1 cascade
   ├── Phase 1.B Domain : recipeCostCalculator.ts pure-TS + tests
   └── Phase 1.C Tests : pgTAP f6_sub_recipes + Vitest live RPC
        │
        ▼ Wave 1 sync gate
Wave 2 (F5 yield + Versioning UI) — 2 phases parallèles
   ├── Phase 2.A DB : yield cols + threshold config + JE update (actual)
   └── Phase 2.B UI : ProductionForm variance modal + /reports/production-yield + RecipeEditor history tab
        │
        ▼
Wave 3 (Recipe UX) — 2 phases parallèles
   ├── Phase 3.A IngredientPicker autocomplete + sub-recipe tab + live preview
   └── Phase 3.B RecipeEditor : DnD + Duplicate + preview card + sum validation badge
        │
        ▼
Wave 4 (Batch + Scheduling) — 2 phases parallèles
   ├── Phase 4.A Batch : production_batches + record_batch_production_v1 + page /production/batch
   └── Phase 4.B Scheduling : production_schedules + suggest RPC + calendar /production/schedule
        │
        ▼
Wave 5 (P3 pro features) — 3 phases parallèles
   ├── Phase 5.A Margin alerts : target_margin col + nightly cron + /production/margin-watch
   ├── Phase 5.B Boulanger's % : recipes.is_baker_percentage + toggle UI + conversion
   └── Phase 5.C Allergens : allergen_type enum + products.allergens + view + badges
        │
        ▼
Wave 6 (closeout) — 1 phase
   └── Phase 6.A Types regen + full test/build + PR draft + CLAUDE.md update
```

---

## 3. Wave 0 — Prerequisites (no code)

### Phase 0.1 — Spec + INDEX + branch (DONE — ce doc)
**Files** : `docs/workplan/specs/2026-05-15-session-15-spec.md` ✓, `docs/workplan/plans/2026-05-15-session-15-INDEX.md` ✓.
**DoD** : Spec & INDEX dated, 18 décisions D1-D18, 14 phases listées, scope in/out explicit.
**Complexity** : S (~1h).
**Suggested executor** : lead (vous).

### Phase 0.2 — Wave 0 commit + branch setup
**Goal** : Commit spec/INDEX/CLAUDE.md sur `swarm/session-15`, ouvrir PR draft.
**Files** : `CLAUDE.md` (update Active Workplan to Session 15), commit Wave 0 docs.
**DoD** : Branch up, CLAUDE.md updated, optionnel PR draft.
**Complexity** : XS (~30 min).
**Dependencies** : Phase 0.1 ✓.

---

## 4. Wave 1 — F6 Sub-recipes

### Phase 1.A — DB : anti-cycle + cost cascade + recipe_versions + record_production cascade
**Goal** : Établir l'infra DB complète pour F6 récursif.
**Module(s)** : 15 (Production & Recipes).
**Files** :
- `supabase/migrations/20260519000001_create_validate_recipe_no_cycle.sql` — trigger BEFORE INSERT/UPDATE.
- `supabase/migrations/20260519000002_create_calculate_recipe_cost_rpc.sql` — RPC récursif (CTE).
- `supabase/migrations/20260519000003_init_recipe_versions.sql` — table + RLS + trigger snapshot.
- `supabase/migrations/20260519000004_backfill_recipe_versions_initial.sql` — snapshot rétroactif des recettes existantes.
- `supabase/migrations/20260519000005_extend_production_records_recipe_version_fk.sql` — add `recipe_version_id`.
- `supabase/migrations/20260519000006_bump_record_production_v1_subrecipe_cascade.sql` — récursion via cost cascade + jsonb `materials_breakdown`.
- `supabase/migrations/20260519000010_extend_production_records_materials_breakdown.sql` — nouvelle colonne `materials_breakdown JSONB`.

**DoD** :
- [ ] Trigger rejette cycle direct (A → B → A) avec ERRCODE P0001.
- [ ] Trigger rejette cycle indirect (A → B → C → A).
- [ ] Trigger rejette profondeur > 5.
- [ ] `calculate_recipe_cost_v1` retourne jsonb avec breakdown récursif correct.
- [ ] Table `recipe_versions` créée, RLS read-only authenticated, snapshot trigger fonctionne sur upsert/deactivate.
- [ ] Backfill : un snapshot existe pour chaque `recipes.product_id` distinct au DBA initial.
- [ ] `record_production_v1` accepte `p_recurse_subrecipes BOOLEAN DEFAULT TRUE`, déduit récursivement les feuilles, populate `materials_breakdown`.

**Complexity** : **L** (~6h).
**Dependencies** : Wave 0.
**Suggested executor** : `recipe-db-arch` (backend-dev + DB SQL).
**Parallelization tag** : parallel with 1.B (domain pure-TS) et 1.C (tests).

### Phase 1.B — Domain : recipeCostCalculator.ts
**Goal** : Pure-TS replication de la cost cascade pour preview UI sans round-trip serveur.
**Module(s)** : 15.
**Files** :
- `packages/domain/src/production/recipeCostCalculator.ts` (CREATE).
- `packages/domain/src/production/__tests__/recipeCostCalculator.test.ts`.
- `packages/domain/src/production/index.ts` (UPDATE export).

**DoD** :
- [ ] Function `calculateRecipeCost(graph: RecipeGraph, productId: string, opts?: {maxDepth: 5}): RecipeCostBreakdown`.
- [ ] Detect cycle → throws `RecipeCycleError`.
- [ ] Tests : flat, 2-level, 5-level, cycle, depth exceeded.

**Complexity** : **S** (~2h).
**Dependencies** : Wave 0.
**Suggested executor** : `recipe-domain-coder`.
**Parallelization tag** : parallel with 1.A et 1.C.

### Phase 1.C — Tests : pgTAP + Vitest live RPC
**Goal** : Garantir la non-régression F6 par tests serveur.
**Module(s)** : 15.
**Files** :
- `supabase/tests/f6_sub_recipes.test.sql` (pgTAP, scénarios T1-T20).
- `supabase/tests/functions/recipe-calculate-cost.test.ts` (live RPC).
- `supabase/tests/functions/recipe-cycle-rejection.test.ts`.
- `supabase/tests/functions/recipe-versions-snapshot.test.ts`.
- `supabase/tests/functions/record-production-cascade.test.ts`.

**DoD** :
- [ ] pgTAP suite green dans le cloud (BEGIN..ROLLBACK envelope).
- [ ] Vitest live RPC green (cible : project `ikcyvlovptebroadgtvd`).
- [ ] Coverage scénarios : (a) recette simple flat, (b) recette 2-niveau croissant→pain choco, (c) cycle direct/indirect rejected, (d) max depth, (e) JE production utilise feuilles atomiques, (f) idempotency replay.

**Complexity** : **M** (~4h).
**Dependencies** : Phase 1.A (RPCs déployées).
**Suggested executor** : `recipe-tester`.
**Parallelization tag** : after 1.A unlocks.

---

## 5. Wave 2 — F5 Yield + Versioning UI

### Phase 2.A — DB : yield cols + JE update
**Goal** : Étendre `production_records` + update JE pour utiliser `actual_yield_qty`.
**Files** :
- `supabase/migrations/20260519000040_extend_production_records_yield.sql` — add `expected_yield_qty`, `actual_yield_qty`, `yield_variance_pct` GENERATED, `yield_variance_reason TEXT`.
- `supabase/migrations/20260519000041_seed_business_config_yield_threshold.sql` — `production.yield_variance_threshold_pct = 15.00`.
- `supabase/migrations/20260519000042_bump_record_production_yield_aware.sql` — populate expected at insert + accept p_actual_yield_qty.
- `supabase/migrations/20260519000043_update_tr_20_je_emit_use_actual_yield.sql` — JE uses actual not produced.
- `supabase/migrations/20260519000044_backfill_production_records_actual_yield.sql` — `actual_yield_qty = quantity_produced` for historical rows.

**DoD** :
- [ ] Migrations applied, types regen.
- [ ] pgTAP `f5_yield_tracking.test.sql` green (variance calc + JE actual + backfill no-op).
- [ ] `production_records.yield_variance_pct` est `GENERATED ALWAYS AS (...) STORED`.

**Complexity** : **M** (~3h).
**Suggested executor** : `yield-db-arch`.
**Parallelization tag** : parallel with 2.B.

### Phase 2.B — UI : ProductionForm + yield report + history tab
**Goal** : UI consommer F5 + versioning history.
**Files** :
- `apps/backoffice/src/features/inventory-production/components/ProductionForm.tsx` (UPDATE) — expected badge + actual field + variance modal.
- `apps/backoffice/src/features/inventory-production/components/YieldVarianceModal.tsx` (CREATE).
- `apps/backoffice/src/features/inventory-production/components/RecipeVersionHistory.tsx` (CREATE).
- `apps/backoffice/src/features/inventory-production/hooks/useRecipeVersions.ts` (CREATE).
- `apps/backoffice/src/pages/reports/ProductionYieldPage.tsx` (CREATE).
- `apps/backoffice/src/routes/index.tsx` (REGISTER `/reports/production-yield`).
- `apps/backoffice/src/features/inventory-production/components/RecipeEditor.tsx` (UPDATE — add History tab).

**DoD** :
- [ ] Modal s'ouvre si `|variance_pct| > 15` au submit, exige reason min 5 chars.
- [ ] Yield report affiche trend per recipe + top-10 outliers.
- [ ] History tab montre timeline avec diffs ingrédients (added/removed/qty change).
- [ ] Smoke tests : `ProductionForm.smoke.test.tsx`, `YieldVarianceModal.smoke.test.tsx`, `RecipeVersionHistory.smoke.test.tsx`, `ProductionYieldPage.smoke.test.tsx`.

**Complexity** : **L** (~5h).
**Dependencies** : Phase 2.A + Phase 1.A.
**Suggested executor** : `yield-ui-coder`.
**Parallelization tag** : parallel with 2.A (UI work on stubs jusqu'à 2.A merge).

---

## 6. Wave 3 — Recipe UX ergonomic

### Phase 3.A — IngredientPicker
**Goal** : Composant autocomplete réutilisable.
**Files** :
- `packages/ui/src/components/IngredientPicker.tsx` (CREATE).
- `apps/backoffice/src/features/products/hooks/useIngredientSearch.ts` (CREATE).
- `supabase/migrations/20260519000080_create_view_recipe_products.sql` (CREATE view).
- `supabase/migrations/20260519000081_create_search_ingredients_rpc.sql` (RPC unifié products + sub-recipes).
- `packages/ui/src/components/__tests__/IngredientPicker.test.tsx`.

**DoD** :
- [ ] Picker debounce 200ms.
- [ ] Tabs "Raw / Semi-finished / Sub-recipe" avec count badges.
- [ ] Live preview cost à droite (utilise `recipeCostCalculator` Phase 1.B).
- [ ] Keyboard nav (↑↓ Enter).

**Complexity** : **M** (~4h).
**Dependencies** : Phase 1.B (cost calc), Phase 1.A (view backing).
**Suggested executor** : `picker-ui-coder`.
**Parallelization tag** : parallel with 3.B.

### Phase 3.B — RecipeEditor : DnD + Duplicate + preview + validation
**Goal** : Améliorer l'éditeur recette existant.
**Files** :
- `apps/backoffice/src/features/inventory-production/components/RecipeEditor.tsx` (UPDATE) — intègre `IngredientPicker`, DnD via `@dnd-kit/sortable`, preview card top, Duplicate button.
- `apps/backoffice/src/features/inventory-production/components/RecipeDuplicateModal.tsx` (CREATE).
- `apps/backoffice/src/features/inventory-production/components/RecipeCostPreviewCard.tsx` (CREATE).
- `supabase/migrations/20260519000082_create_duplicate_recipe_rpc.sql` (CREATE).
- `apps/backoffice/src/features/inventory-production/__tests__/RecipeEditor.smoke.test.tsx` (UPDATE).

**DoD** :
- [ ] Drag-to-reorder rows persiste via UPDATE batch.
- [ ] Duplicate clone toutes les rows actives vers target product, audit log.
- [ ] Preview card affiche cost cascade + marge + selling price + photo.
- [ ] Validation badge si écart > 5% entre `Σ(qty × cost)` et `product.cost_price`.

**Complexity** : **L** (~4h).
**Dependencies** : Phase 3.A.
**Suggested executor** : `editor-ui-coder`.

---

## 7. Wave 4 — Batch + Scheduling

### Phase 4.A — Batch production
**Goal** : Multi-recipe en une opération atomique.
**Files** :
- `supabase/migrations/20260519000100_init_production_batches.sql` — table + FK.
- `supabase/migrations/20260519000101_extend_production_records_batch_fk.sql`.
- `supabase/migrations/20260519000102_create_record_batch_production_rpc.sql`.
- `apps/backoffice/src/pages/inventory/BatchProductionPage.tsx` (CREATE).
- `apps/backoffice/src/features/inventory-production/components/BatchSelector.tsx` (CREATE).
- `apps/backoffice/src/features/inventory-production/components/IngredientAggregatePreview.tsx` (CREATE).
- `apps/backoffice/src/routes/index.tsx` (REGISTER `/inventory/production/batch`).
- pgTAP `batch_production.test.sql`.

**DoD** :
- [ ] Submit 3 recipes → 3 `production_records` créés liés à 1 `production_batches` row.
- [ ] Si stock insuffisant pour un seul item → ROLLBACK complet.
- [ ] Idempotency key fonctionne (replay = no-op + return existing).

**Complexity** : **L** (~6h).
**Dependencies** : Phase 1.A.
**Suggested executor** : `batch-arch`.
**Parallelization tag** : parallel with 4.B.

### Phase 4.B — Production scheduling
**Goal** : Calendar de planification + suggestions.
**Files** :
- `supabase/migrations/20260519000120_init_production_schedules.sql`.
- `supabase/migrations/20260519000121_create_suggest_production_schedule_rpc.sql`.
- `supabase/migrations/20260519000122_grant_inventory_production_schedule_perm.sql`.
- `apps/backoffice/src/pages/inventory/ProductionSchedulePage.tsx` (CREATE).
- `apps/backoffice/src/features/inventory-production/components/ProductionCalendarGrid.tsx` (CREATE).
- `apps/backoffice/src/features/inventory-production/components/ScheduleSlotCell.tsx` (CREATE).
- `apps/backoffice/src/features/inventory-production/hooks/useProductionSchedule.ts` (CREATE).
- `apps/backoffice/src/routes/index.tsx` (REGISTER `/inventory/production/schedule`).
- pgTAP `production_schedule.test.sql`.

**DoD** :
- [ ] 7-day grid, 4 slots/day (5am/7am/11am/4pm).
- [ ] Suggestions chargées via `suggest_production_schedule_v1`.
- [ ] Validate "scheduled → started → completed" lifecycle.
- [ ] Permission `inventory.production.schedule` requise pour edit.

**Complexity** : **L** (~6h).
**Dependencies** : Phase 1.A.
**Suggested executor** : `schedule-arch`.
**Parallelization tag** : parallel with 4.A.

---

## 8. Wave 5 — P3 pro features

### Phase 5.A — Margin alerts
**Files** :
- `supabase/migrations/20260519000140_extend_products_target_margin.sql`.
- `supabase/migrations/20260519000141_init_margin_alerts.sql`.
- `supabase/migrations/20260519000142_pg_cron_recompute_margins.sql` (daily 02:00 UTC).
- `apps/backoffice/src/pages/inventory/MarginWatchPage.tsx` (CREATE).
- `apps/backoffice/src/features/inventory-production/hooks/useMarginAlerts.ts`.
- `apps/backoffice/src/routes/index.tsx` (REGISTER `/inventory/production/margin-watch`).
- pgTAP `margin_alerts.test.sql`.

**Complexity** : **M** (~3h).
**Dependencies** : Phase 1.A (cost RPC).
**Parallelization tag** : parallel with 5.B / 5.C.

### Phase 5.B — Boulanger's percentages
**Files** :
- `supabase/migrations/20260519000150_extend_recipes_baker_percentage.sql`.
- `apps/backoffice/src/features/inventory-production/components/BoulangerModeToggle.tsx` (CREATE).
- Update `RecipeEditor.tsx` — switch saisie en % vs absolu, conversion.
- pgTAP `baker_percentage.test.sql`.

**Complexity** : **M** (~3h).
**Dependencies** : Phase 3.B (RecipeEditor intégré).
**Parallelization tag** : parallel with 5.A / 5.C.

### Phase 5.C — Allergens structurés
**Files** :
- `supabase/migrations/20260519000160_create_allergen_type_enum.sql`.
- `supabase/migrations/20260519000161_extend_products_allergens.sql`.
- `supabase/migrations/20260519000162_create_view_product_allergens_resolved.sql` (CTE récursive).
- `apps/backoffice/src/features/products/components/AllergensSelector.tsx` (CREATE).
- `packages/ui/src/components/AllergenBadge.tsx` (CREATE).
- `apps/backoffice/src/pages/Products.tsx` (UPDATE) — affiche badges sur fiche.
- `apps/pos/src/features/products/components/ProductCard.tsx` (UPDATE) — badge mini si allergen présent.
- pgTAP `allergens.test.sql`.

**Complexity** : **M** (~4h).
**Dependencies** : Phase 1.A (recipe cascade).
**Parallelization tag** : parallel with 5.A / 5.B.

---

## 9. Wave 6 — Closeout

### Phase 6.A — Types regen + tests + PR
**Goal** : Finaliser session.
**Steps** :
- [ ] MCP `generate_typescript_types project_id=ikcyvlovptebroadgtvd` → write `packages/supabase/src/types.generated.ts`.
- [ ] `pnpm typecheck` green.
- [ ] `pnpm exec turbo run test --concurrency=1` green.
- [ ] `pnpm build` green.
- [ ] Bundle size delta < +50KB vs Session 14 baseline.
- [ ] CLAUDE.md "Active Workplan" section : pointer Session 16 (next).
- [ ] PR draft "Session 15 — Bakery Production (F6 + F5 + Recipe pro)" → master, body avec liste 30+ migrations + diff résumé.
- [ ] Tag deviation packs résiduels dans INDEX §10.

**Complexity** : **S** (~2h).
**Suggested executor** : lead.

---

## 10. Parallelization map

| Wave | Phases | Parallel streams | Estim h |
|---|---|---|---|
| 0 | 0.1, 0.2 | sequential | 1.5 |
| 1 | 1.A, 1.B, 1.C | 3 (1.C after 1.A) | max(6, 2, 4) = 6 |
| 2 | 2.A, 2.B | 2 | max(3, 5) = 5 |
| 3 | 3.A, 3.B | 2 (3.B after 3.A) | 4 + 4 = 8 |
| 4 | 4.A, 4.B | 2 parallel | max(6, 6) = 6 |
| 5 | 5.A, 5.B, 5.C | 3 parallel | max(3, 3, 4) = 4 |
| 6 | 6.A | 1 | 2 |
| **TOTAL** | **14** | **6 waves** | **~32h** (full parallel-optimized) |

Realistic with ~30% serialization overhead + reviewer gate per wave : ~55h.

---

## 11. Comms entre subagents

```
lead (Claude) ←→ recipe-db-arch / recipe-domain-coder / recipe-tester (Wave 1)
              ←→ yield-db-arch / yield-ui-coder (Wave 2)
              ←→ picker-ui-coder / editor-ui-coder (Wave 3)
              ←→ batch-arch / schedule-arch (Wave 4)
              ←→ margin-arch / boulanger-coder / allergens-arch (Wave 5)
              ←→ reviewer (gate per wave)
```

Pattern : chaque subagent SendMessage `lead` à completion ; lead route à `reviewer` puis prochaine wave.

---

## 12. Out of scope (déféré Session 16+)

- Mobile production page (Capacitor shell pending).
- IoT four (hardware pending).
- Yield forecaster ML (need stable F5 first).
- Ghost stock cleanup page (Inventory follow-up, pas production).
- Waste tracking UX upgrade (Inventory follow-up).
- Deviation packs Session 13 résiduels :
  - Playwright CI job (D-W6-6C-05).
  - pg_net-based birthday cron (D-W6-6B-02).
  - Cash Flow Investing/Financing sections (D-W6-6A-2).
  - mv_pl_monthly branched reuse (D-W6-6A-1).
  - staging-deploy.yml secrets (D-W6-CICD-01).

Session 15 = **production bakery uniquement**. Tout autre item attend Session 16+.

---

## 13. Deviation packs (Session 15 → Session 16+)

Recorded across phases during execution. All deviations are functionally non-blocking and are filed as follow-ups for Session 16+ triage.

| ID | Phase | Description | Severity |
|---|---|---|---|
| **DEV-S15-2.A-01** | 2.A | `business_config` is a flat columned table (not key-value) ; threshold stored as ratio (0.15) in `production_yield_variance_threshold_pct` column. UI auto-converts to/from percentage. | informational |
| **DEV-S15-2.B-01** | 2.B | `recipe_versions.snapshot` has no `cost_price` in payload ; `RecipeVersionHistory` does not display per-version cost reconstruction (would require cross-join to current `products.cost_price`). | low |
| **DEV-S15-3.A-01** | 3.A | `semi_finished` kind in `search_ingredients_v1` falls back to "recipe nesting depth ≥ 2" instead of a dedicated `is_semi_finished` flag (no such flag exists on `products`). | low |
| **DEV-S15-3.A-02** | 3.A | `pg_trgm` extension is installed but no trigram indexes on `products.name` / `products.sku`. Picker ranking deferred. | low |
| **DEV-S15-3.B-01** | 3.B | `audit_log` schema uses `subject_table` / `subject_id` / `payload`, not `target_id` / `metadata` as the original spec template referenced — `duplicate_recipe_v1` writes to the canonical schema. | informational |
| **DEV-S15-4.A-01** | 4.A | Migration `20260519000103_fix_record_batch_production_temptbl.sql` shipped to fix same-transaction temp-table collision in `record_batch_production_v1` (matches the known `record_production_v1` quirk). | informational |
| **DEV-S15-4.A-02** | 4.A | `IngredientAggregatePreview` UI walks only depth-1 of each recipe (uses domain `expandRecipe`). Server-side validation in RPC still cascades fully. Multi-level preview deferred. | low |
| **DEV-S15-4.B-01** | 4.B | `view_product_sales` does not exist on V3 ; `suggest_production_schedule_v1` aggregates directly from `order_items` joined to `orders`. Documented in the migration header. | informational |
| **DEV-S15-4.B-02** | 4.B | Resolved `production_schedules.recipe_id → products(id)` FK ambiguity (4 referenced relations) by post-fetching product names client-side in `useProductionSchedules`. | informational |
| **DEV-S15-5.A-01** | 5.A | `recompute_recipe_margins_v1` calls `_calculate_recipe_cost_walk` internal helper directly (bypassing public RPC `inventory.read` gate) — required because pg_cron has no `auth.uid()`. | informational |
| **DEV-S15-5.B-01** | 5.B | `upsert_recipe_v1` body bumped (signature kept stable via trailing DEFAULT params) to accept baker percentage. | informational |
| **DEV-S15-5.B-02** | 5.B | `BakerPreviewPanel.tsx` extracted from `RecipeEditor.tsx` to keep the editor under 500 lines (497). | informational |
| **DEV-S15-5.C-01** | 5.C | Receipt template integration + customer display integration for allergen badges deferred to Session 16. Touches print queue / template renderer. | low |
| **DEV-S15-CI-01** | 6.A | `supabase-tests` CI job has been red since Session 13 merge (also red on PR #13, #14). Root cause is migration ordering vs `supabase/seed.sql` : seed.sql runs AFTER migrations on fresh Docker, so Session 13 migrations that reference seed-only roles/permissions fail. Session 15 applied 3 hotfixes to `20260517000030_refactor_has_permission.sql` (defensive roles + base perms seeds, remove DROP FUNCTION) that close 3 of the cascading failures, but the next failure (`20260517000031_init_edge_function_rate_limits.sql` partial-index predicate `WHERE window_end < now()` requires IMMUTABLE function) remains. PR #17 merged as-is, matching the existing baseline policy. Full CI revival is its own Session 16 effort (audit all Session 13 migrations + reorder seeds OR drop the supabase-tests job in favor of pgTAP-on-cloud via MCP). | medium |

**Resolution targets:** each item has a follow-up backlog item filed in `docs/workplan/backlog-by-module/15-production-recipes.md` for Session 16+ triage.

---

*INDEX écrit 2026-05-15 sur `swarm/session-15` par lead session 15 (autonomous mode).*
*§13 ajouté 2026-05-16 lors du closeout Phase 6.A.*
