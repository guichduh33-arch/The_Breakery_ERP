# Session 15 — PR DRAFT (do not auto-open)

> This is a draft of the pull-request body that *would* be used when the maintainer authorizes PR creation for `swarm/session-15 → master`. Per project policy, PR creation requires explicit user authorization. This file is for reference only.

---

**Title:** Session 15 — Bakery Production (F6 + F5 + Recipe pro features)

**Base:** `master`
**Head:** `swarm/session-15` (alias `claude/pull-latest-changes-amz9A`, HEAD `8ef9c7c`)

---

## Summary

- **F6 — Sub-recipes (recursive recipes).** DB-level anti-cycle trigger + recursive cost RPC (`calculate_recipe_cost_v1`) + `recipe_versions` snapshot history + recursive leaf-deduction in `record_production_v1` (atomic single-tx). Pure-TS `recipeCostCalculator` for UI preview.
- **F5 — Yield tracking.** `production_records.expected_yield_qty` / `actual_yield_qty` / `yield_variance_pct` (GENERATED) + `yield_variance_reason` ; variance modal in `ProductionForm` triggered above configurable threshold (default 15 %) ; `/reports/production-yield` trend page ; JE source-of-truth switched to `actual_yield_qty`.
- **Recipe pro features.** `IngredientPicker` autocomplete (raw / semi-finished / sub-recipe tabs with live cost preview) ; `RecipeEditor` DnD + Duplicate + cost preview card + validation badge ; `production_batches` + `record_batch_production_v1` atomic multi-recipe page ; `production_schedules` + `suggest_production_schedule_v1` calendar page ; nightly `recompute_recipe_margins_v1` cron + `MarginWatchPage` ; `recipes.is_baker_percentage` toggle + `BoulangerModeToggle` ; EU `allergen_type` enum + `products.allergens` + recursive `view_product_allergens_resolved` + POS `ProductCard` allergen badges.

## Stats

- **53 commits** on `swarm/session-15` (alias branch `claude/pull-latest-changes-amz9A`).
- **32 migrations** in block `20260519000001..162`.
- **14 phases / 6 waves.**
- **0 schema-breaking changes** — `record_production_v1` extended via DEFAULT-valued params ; `upsert_recipe_v1` body bumped with stable signature.

## Migrations (32, block `20260519000001..162`)

```
20260519000001  create_validate_recipe_no_cycle
20260519000002  create_calculate_recipe_cost_rpc
20260519000003  init_recipe_versions
20260519000004  backfill_recipe_versions_initial
20260519000005  extend_production_records_recipe_version_fk
20260519000006  bump_record_production_v1_subrecipe_cascade
20260519000010  extend_production_records_materials_breakdown
20260519000020  revoke_calculate_recipe_cost_walk_helper
20260519000040  extend_production_records_yield
20260519000041  seed_business_config_yield_threshold
20260519000042  bump_record_production_yield_aware
20260519000043  update_tr_20_je_emit_use_actual_yield
20260519000044  backfill_production_records_actual_yield
20260519000080  create_view_recipe_products
20260519000081  create_search_ingredients_rpc
20260519000082  create_duplicate_recipe_rpc
20260519000083  extend_recipes_display_order
20260519000100  init_production_batches
20260519000101  extend_production_records_batch_fk
20260519000102  create_record_batch_production_rpc
20260519000103  fix_record_batch_production_temptbl
20260519000120  init_production_schedules
20260519000121  create_suggest_production_schedule_rpc
20260519000122  grant_inventory_production_schedule_perm
20260519000140  extend_products_target_margin
20260519000141  init_margin_alerts
20260519000142  pg_cron_recompute_margins
20260519000150  extend_recipes_baker_percentage
20260519000151  bump_upsert_recipe_v1_baker
20260519000160  create_allergen_type_enum
20260519000161  extend_products_allergens
20260519000162  create_view_product_allergens_resolved
```

All 32 applied to the V3 dev cloud project `ikcyvlovptebroadgtvd` via `mcp__plugin_supabase_supabase__apply_migration`.

## DoD checklist (from spec §6)

- [x] 14 phases delivered (Wave 0..6).
- [x] 32 migrations cloud apply OK (monotonic numbering `20260519000001..162`).
- [x] Types regen + commit `packages/supabase/src/types.generated.ts` (regenerated 5 times across waves).
- [x] `pnpm typecheck` green on `swarm/session-15`.
- [x] `pnpm exec turbo run test --concurrency=1` — Session 15 packages green ; pre-existing failures (POS 4 files + backoffice 13 env-var) unchanged from the merge-base baseline.
- [x] `pnpm build` green.
- [x] pgTAP suite green (8 new files : `f6_sub_recipes`, `recipe_versions`, `f5_yield_tracking`, `batch_production`, `production_schedule`, `margin_alerts`, `baker_percentage`, `allergens`).
- [x] Vitest live RPC green (`recipe-calculate-cost`, `recipe-cycle-rejection`, `recipe-versions-snapshot`, `record-production-cascade`).
- [x] CLAUDE.md "Active Workplan" pointer moved to Session 16.
- [x] Deviation packs documented in INDEX §13 + backlog 15.
- [ ] PR draft prepared (this file) — **PR creation deferred to maintainer authorization**.

## Test plan

- [ ] `pnpm typecheck` — all 6 packages green.
- [ ] `pnpm exec turbo run test --concurrency=1` — 4 packages green ; backoffice 65 passed + 13 env-var failures (baseline) ; POS 53 passed + 4 pre-existing failures (happy-hour, display, order-history, payment — none touched by Session 15).
- [ ] `pnpm build` — both apps build, gzip sizes within informal Session 14 envelope (backoffice main JS 1,780.31 kB / gzip 465.12 kB ; POS 859.95 kB / gzip 238.83 kB).
- [ ] Cloud migrations applied + pgTAP green on `ikcyvlovptebroadgtvd`.
- [ ] Manual smoke :
  - `/inventory/production/batch` — select 2 recipes, validate aggregate preview, submit.
  - `/inventory/production/schedule` — see auto-suggestions, drag-reschedule.
  - `/inventory/production/margin-watch` — list under-threshold items, acknowledge.
  - `RecipeEditor` — toggle Boulanger mode, observe baker preview panel.
  - `RecipeEditor` — duplicate active recipe to another product.
  - POS `ProductCard` — verify allergen badges render for tagged products.
  - `ProductionForm` — submit with variance > 15 %, confirm reason modal.

## Deviations

Tracked in INDEX §13 — see [`docs/workplan/plans/2026-05-15-session-15-INDEX.md#13-deviation-packs-session-15--session-16`](./2026-05-15-session-15-INDEX.md). 13 deviations recorded across phases ; all informational or low-severity. Follow-ups filed in [`docs/workplan/backlog-by-module/15-production-recipes.md`](../backlog-by-module/15-production-recipes.md) under "Session 15 → Session 16+ follow-ups".

---

*Draft written 2026-05-16 during Phase 6.A closeout. Do not open PR until maintainer authorizes.*
