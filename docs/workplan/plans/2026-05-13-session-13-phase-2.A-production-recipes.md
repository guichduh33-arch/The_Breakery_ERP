# Session 13 — Phase 2.A sub-plan : Production + Recipes

> **Date**       : 2026-05-14
> **Branch**     : `swarm/session-13`
> **Parent INDEX** : [`./2026-05-13-session-13-INDEX.md`](./2026-05-13-session-13-INDEX.md) §Phase 2.A (line ~443)
> **Spec source**   : [`../specs/2026-05-13-session-13-spec.md`](../specs/2026-05-13-session-13-spec.md)
> **Module ref**    : [`../../reference/04-modules/15-production-recipes.md`](../../reference/04-modules/15-production-recipes.md)
> **Migration block reserved** : `20260517000060..000066` (7 migrations).

## 1. Context (state at startup, verified 2026-05-14)

Wave 1 is DONE. Staging project `ikcyvlovptebroadgtvd` has :

- ✅ `accounting_mappings` rows (`is_active=true`) for `PRODUCTION_COGS` (5110), `INVENTORY_GENERAL` (1141), `INVENTORY_RAW_MATERIAL` (1142), `INVENTORY_FINISHED_GOODS` (1143), `WASTE_EXPENSE` (5210). The `accounting_mappings` table has no `postable` column — the resolver `resolve_mapping_account(text)` filters on `accounts.is_postable` directly. The five mapping_keys above resolve to postable accounts.
- ✅ trigger `tr_20_je_emit` on `stock_movements` (migration `20260517000023`) emits **one JE per row** :
  - `production_in` → DR `INVENTORY_FINISHED_GOODS` / CR `PRODUCTION_COGS`
  - `production_out` → DR `PRODUCTION_COGS` / CR `INVENTORY_RAW_MATERIAL`
  - Net effect of a balanced production batch : DR FG = ΣCR FG-side ; DR COGS via outs = CR COGS via in (they pair when cost_price * quantity_produced ≈ Σ(cost_price * material_qty), i.e. recipe is properly costed). **No application-side JE call is needed** — the RPC just INSERTs movements via `record_stock_movement_v1`.
- ✅ `record_stock_movement_v1` (v5 signature) accepts `p_lot_id UUID DEFAULT NULL`. For `production_out` with `p_lot_id NULL`, the RPC resolves FIFO lot UPFRONT if `stock_lots` table has rows for the material ; falls back to `lot_id=NULL` if no F1 lot available.
- ✅ `create_stock_lot_v1` exists with idempotency support.
- ✅ `convert_quantity(p_qty numeric, p_from_unit text, p_to_unit text)` exists — pure unit conversion (g↔kg, mL↔L, pcs↔pcs, no product-specific factor).
- ✅ Permissions already seeded :
  - `inventory.production.create` (description: "Record a production batch (consumes ingredients via recipe)") — granted to SUPER_ADMIN, ADMIN, MANAGER.
  - `inventory.production.delete` (description: "Revert a production record (restores stock + counter-JE) — ADMIN+") — granted to SUPER_ADMIN, ADMIN.
  - `inventory.recipes.update` (description: "Edit recipes (Bill of Materials)") — granted to SUPER_ADMIN, ADMIN. **MUST grant to MANAGER** (spec : "manager+ INSERT/UPDATE").
  - `inventory.read` (granted to SUPER_ADMIN/ADMIN/MANAGER) — used for SELECT on `recipes` / `production_records` / view_product_recipes.
- ✅ `sections(id, code, name, kind, is_active, display_order, deleted_at, ...)` exists.
- ✅ `user_profiles(id, auth_user_id, employee_code, full_name, role_code, ...)` — `production_records.staff_id` FKs to this.
- ✅ `audit_log` columns : `(id bigint, occurred_at, actor_profile_id uuid, action text, subject_table text, subject_id uuid, payload jsonb)`. Migration `20260517000034_drop_legacy_audit_log_singular` kept `audit_log` as a compat VIEW that routes writes to `audit_logs` (plural) via INSTEAD OF trigger — so writing to `audit_log` continues to work.
- ✅ movement_type enum has `production_in`, `production_out` (verified via `enum_range`).
- ✅ Spec deviation we accept :
  - The INDEX says perm name `inventory.recipes.manage` and `inventory.production.revert`. We REUSE existing **`inventory.recipes.update`** and **`inventory.production.delete`** (V2→V3 path translation). Document in `wave-2-deviations.md`.

## 2. Decisions (locked for this phase)

- **D-2A-1 Decimal width** : All quantity columns use `DECIMAL(10,3)` (matches `recipes` spec). Cost columns `DECIMAL(14,2)` (IDR-compatible). Production_records.je_posted/materials_consumed/stock_updated default FALSE.
- **D-2A-2 No application JE call** : the trigger `tr_20_je_emit` handles per-movement JE. `record_production_v1` only INSERTs the 1 + N movements via `record_stock_movement_v1`, then post-hoc UPDATEs `production_records.je_posted=true` if at least one `journal_entries.reference_id=movement_id` row was found referencing one of the produced movements. **No counter-passation written here** — the trigger is the source of truth.
- **D-2A-3 Section_id reference** : `production_records.section_id` is the section where production happens. For `record_stock_movement_v1`, we pass `p_to_section_id=section_id` on `production_in` and `p_from_section_id=section_id` on each `production_out`. This keeps `section_stock` consistent.
- **D-2A-4 Idempotency** : `record_production_v1(p_idempotency_key UUID)` → first row insert uses that key directly on `production_records.idempotency_key` (UNIQUE) and ALSO on the `production_in` movement. Each `production_out` movement gets `idempotency_key=NULL` (its uniqueness comes from `(reference_type='production', reference_id, product_id)` ; a deterministic recovery on replay returns the existing production_record). Replay path : SELECT `production_records` BY idempotency_key first ; if found, return JSONB with `idempotent_replay=true`.
- **D-2A-5 Lot upfront** : if `products.default_shelf_life_hours IS NOT NULL` for the produced product, call `create_stock_lot_v1` with `p_quantity=quantity_produced`, `p_idempotency_key=md5(idempotency_key||':lot')::uuid` (deterministic, but distinct from the production key). Pass the returned `lot_id` to the `production_in` `record_stock_movement_v1` call.
- **D-2A-6 Waste handling MVP** : `quantity_waste` is **stored on the production_record** but does NOT create a separate `production_waste` movement in this phase. The waste matter is still subtracted from raw materials (the recipe is multiplied by `quantity_produced + quantity_waste` for material consumption). The vendable produced stock only adds `quantity_produced`. Rationale : spec §6 says "waste is subtracted from raw materials but not entering vendable stock" — keeps trigger JE accurate (only one production_in for the vendable qty). A follow-up "waste reason" sub-table is deferred to Phase X.
- **D-2A-7 Movement reasons** : `production_in` reason = `'Production batch <production_number>'` ; `production_out` reason = `'Material consumed by <production_number>'`. Both ≥ 3 chars (record_stock_movement_v1 guard).
- **D-2A-8 Revert window** : `revert_production_v1` raises `production_too_old` if `production_date < NOW() - INTERVAL '24 hours'`. Strict — no override flag in MVP. ADMIN+ only via `has_permission(auth.uid(), 'inventory.production.delete')`.
- **D-2A-9 Revert mechanics** :
  - Locate the original `production_in` + N `production_out` movements via `WHERE reference_type='production' AND reference_id=p_production_id`.
  - INSERT reverse rows via `record_stock_movement_v1` with NEGATED quantity, `p_movement_type` swapped (`production_in` → `production_in` with negated qty — semantically a "production_in_reversal" but stays in the same enum value to preserve trigger-side JE pairing : trigger sees `qty < 0` and the existing JE logic uses ABS(quantity) — but trigger ALSO uses `movement_type` to pick DR/CR, so reverse would mis-post). **Decision** : we use the same `movement_type` and negate quantity ; trigger still posts a JE with same DR/CR but value will be NEGATIVE → `round_idr(cost*ABS(qty))` is positive, so trigger posts a normal JE — that's the WRONG direction. **Better** : write **dedicated reversal movement_types**. But adding new enum values is risky cross-phase.
  - **Final D-2A-9 mechanism (clean)** : in `revert_production_v1`, INSERT **identical-direction movements** with NEGATED qty. The trigger's `tr_stock_movement_je()` skips zero-value (qty=0). For non-zero negative qty, ABS(quantity) is positive and DR/CR mapping fires the same direction → wrong. **So we instead bypass the trigger via `metadata->>'reverse_of_production'=true` discriminant** and write the counter-JE explicitly inside `revert_production_v1`. The trigger SKIPS rows where `metadata->>'reverse_of_production' = 'true'`.
  - For lots : if the production created a `stock_lots` row, set `stock_lots.status='consumed'` and `stock_lots.quantity=0` (audit-trail preserved via update of `updated_at`). For lots consumed by `production_out` (FIFO-resolved), we DO NOT re-credit specific lots ; the reversal increment lands as `lot_id=NULL` (acceptable MVP — Phase 1.D F1 review-driven). Document this in deviations.
  - **Update trigger function**: we need to modify `tr_stock_movement_je()` to skip rows with `metadata->>'reverse_of_production' = 'true'` — but that means a CREATE OR REPLACE on the trigger function. This is permissible (not has_permission). The companion counter-JE is INSERTed explicitly by `revert_production_v1`.
  - **production_records flags** : set `materials_consumed=false`, `stock_updated=false`, `je_posted=false` ; ADD a soft-delete equivalent → add column `reverted_at TIMESTAMPTZ NULL`, `reverted_by UUID NULL` populated by revert RPC.
- **D-2A-10 Suggestions formula** : `get_production_suggestions_v1(p_lookback_days, p_priority_high, p_priority_medium)` returns per-finished-product :
  - `avg_daily_sales = SUM(oi.quantity over lookback) / lookback_days`
  - `current_stock = products.current_stock`
  - `days_of_stock = current_stock / NULLIF(avg_daily_sales, 0)`
  - `suggested_quantity = GREATEST(0, ROUND(avg_daily_sales * 3) - current_stock)` (target 3 days coverage, configurable later)
  - `priority` : `'high'` if `days_of_stock < p_priority_high`, `'medium'` if `< p_priority_medium`, else `'low'`. Skip products with `avg_daily_sales=0` (no demand history → no suggestion).
  - Filter on `products.product_type='finished'` AND a `recipes WHERE product_id=p.id AND is_active AND deleted_at IS NULL` row exists.
  - Permission `inventory.read`.
- **D-2A-11 RecipeEditor scope** : Phase 2.A ships a STANDALONE Recipe Editor page at `/backoffice/inventory/recipes` (list of products with active recipes + drilldown). The fiche-produit inline tab is a follow-up (cross-team coordination with module 05 owner). The standalone page is fully sufficient for E2E and unlocks ProductionPage usage.
- **D-2A-12 View security** : `view_product_recipes` is created `WITH (security_invoker=true)` so the caller's RLS applies to underlying `products` and `recipes` SELECT.
- **D-2A-13 Production number generation** : sequence `production_records_seq` (created in migration `000061`). Number format `'PROD-' || to_char(now() AT TIME ZONE 'Asia/Jakarta','YYYYMMDD') || '-' || lpad(nextval('production_records_seq')::text,4,'0')`. Per-day rollover handled by sequence + date prefix concat (a duplicate is impossible since nextval is unique forever ; the date prefix is cosmetic for sorting).
- **D-2A-14 Skip-trigger discriminant on revert** : `tr_stock_movement_je()` body is patched (CREATE OR REPLACE) in migration `000064` (revert RPC migration) to add early-return `IF NEW.metadata->>'reverse_of_production' = 'true' THEN RETURN NEW; END IF;` at the top.

## 3. Tasks

### Task A — Migrations `000060` + `000061` (recipes + production_records schemas) + pgTAP T_PROD_01..04

**Files**
- `supabase/migrations/20260517000060_init_recipes.sql` (CREATE)
- `supabase/migrations/20260517000061_init_production_records.sql` (CREATE)
- `supabase/tests/inventory_production.test.sql` (CREATE — pgTAP T_PROD_01..04 = table existence + columns + UNIQUE partial + RLS lockdown)
- Grant `inventory.recipes.update` to MANAGER role (inside `000060` via `INSERT INTO role_permissions ON CONFLICT DO NOTHING` — no `has_permission` re-CREATE).

**Acceptance**
- `recipes(id, product_id, material_id, quantity DECIMAL(10,3), unit, is_active, notes, created_at, updated_at, deleted_at)` exists, RLS enabled, UNIQUE PARTIAL `(product_id, material_id) WHERE is_active=true AND deleted_at IS NULL`.
- `production_records(id, production_number TEXT UNIQUE, product_id FK, quantity_produced DECIMAL(10,3), quantity_waste DECIMAL(10,3) DEFAULT 0, production_date TIMESTAMPTZ DEFAULT now(), section_id UUID FK, staff_id UUID FK user_profiles, batch_number TEXT, notes TEXT, materials_consumed BOOLEAN DEFAULT false, stock_updated BOOLEAN DEFAULT false, je_posted BOOLEAN DEFAULT false, idempotency_key UUID UNIQUE, reverted_at TIMESTAMPTZ NULL, reverted_by UUID NULL, created_at, updated_at)` exists.
- pgTAP : T_PROD_01 has_table recipes ; T_PROD_02 columns of recipes ; T_PROD_03 has_table production_records ; T_PROD_04 RLS lockdown.

**Commit** : `feat(db): session 13 — phase 2.A — init recipes + production_records tables`

### Task B — Migration `000062` (recipe RPCs) + pgTAP T_PROD_05..07

**Files**
- `supabase/migrations/20260517000062_create_recipe_rpcs.sql` (CREATE)
- `supabase/tests/inventory_production.test.sql` (APPEND T_PROD_05..07)

**RPC signatures**
```sql
upsert_recipe_v1(
  p_product_id UUID, p_material_id UUID, p_quantity DECIMAL,
  p_unit TEXT, p_notes TEXT DEFAULT NULL
) RETURNS UUID SECURITY DEFINER
-- has_permission(auth.uid(), 'inventory.recipes.update'). MANAGER+.

list_recipes_v1(p_product_id UUID) RETURNS SETOF JSONB
-- SECURITY DEFINER, has_permission(auth.uid(), 'inventory.read').

deactivate_recipe_v1(p_recipe_id UUID) RETURNS UUID
-- has_permission(auth.uid(), 'inventory.recipes.update'). Sets is_active=false + deleted_at=now().
```

**Acceptance**
- T_PROD_05 upsert as MANAGER inserts then updates the row in place.
- T_PROD_06 upsert as CASHIER → `forbidden` (P0003).
- T_PROD_07 deactivate as ADMIN flips `is_active=false` + `deleted_at IS NOT NULL`.

**Commit** : `feat(db): session 13 — phase 2.A — recipe RPCs (upsert/list/deactivate)`

### Task C — Migration `000063` (`record_production_v1`) + pgTAP T_PROD_08..12

**Files**
- `supabase/migrations/20260517000063_create_record_production_rpc.sql` (CREATE) — includes `CREATE SEQUENCE IF NOT EXISTS production_records_seq` (idempotent ; the seq was added in `000061` ; we keep the IF NOT EXISTS for safety).
- `supabase/tests/inventory_production.test.sql` (APPEND T_PROD_08..12)

**RPC signature**
```sql
record_production_v1(
  p_product_id        UUID,
  p_quantity_produced DECIMAL(10,3),
  p_section_id        UUID,
  p_batch_number      TEXT          DEFAULT NULL,
  p_quantity_waste    DECIMAL(10,3) DEFAULT 0,
  p_notes             TEXT          DEFAULT NULL,
  p_idempotency_key   UUID          DEFAULT NULL
) RETURNS JSONB SECURITY DEFINER
```

**Logic**
1. Permission gate `inventory.production.create` (P0003 `forbidden`).
2. Validate `p_quantity_produced > 0`, `p_quantity_waste >= 0`.
3. **Idempotency replay** : if `p_idempotency_key IS NOT NULL` and a `production_records` row exists with that key → return JSON `{production_id, production_number, idempotent_replay:true}`.
4. SELECT product : `unit`, `cost_price`, `default_shelf_life_hours`, `product_type` (verify `finished`).
5. SELECT recipes WHERE `product_id = p_product_id AND is_active=true AND deleted_at IS NULL` JOIN products m ON m.id = material_id → recipe rows : `(material_id, quantity, unit, material_unit, current_stock, cost_price)`.
6. If no recipes → `RAISE EXCEPTION 'recipe_not_found' USING ERRCODE='P0002'`.
7. **Insufficient stock check** : for each recipe row compute `consumed_in_material_unit = convert_quantity(recipe.quantity * (p_quantity_produced + p_quantity_waste), recipe.unit, material.unit)`. Compare to `material.current_stock`. Collect missing items into a JSONB array. If any missing → `RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0002', DETAIL=missing_json::text`.
8. **Create lot upfront** if `default_shelf_life_hours IS NOT NULL` → `v_lot_id := (create_stock_lot_v1(p_product_id, p_quantity_produced, product.unit, NULL, NULL, p_batch_number, md5(coalesce(p_idempotency_key::text,'') || ':lot')::uuid → cast back to uuid via gen_random_uuid() if NULL key, '{}'::jsonb))->>'lot_id'`. Use `p_batch_number` as the lot batch_number.
9. **Generate production_number** : `'PROD-' || to_char(now() AT TIME ZONE 'Asia/Jakarta','YYYYMMDD') || '-' || lpad(nextval('production_records_seq')::text, 4, '0')`.
10. INSERT production_records (capture `v_production_id`).
11. Call `record_stock_movement_v1` for `production_in` :
    - `p_quantity = +p_quantity_produced`
    - `p_unit = product.unit`
    - `p_reason = 'Production batch ' || production_number`
    - `p_to_section_id = p_section_id`
    - `p_metadata = jsonb_build_object('production_id', v_production_id, 'batch_number', p_batch_number)`
    - `p_lot_id = v_lot_id`
    - `p_idempotency_key = p_idempotency_key` (replay safety on the IN movement too)
    - **THEN** UPDATE that just-inserted row : `SET reference_type='production', reference_id=v_production_id` (since `record_stock_movement_v1` hardcodes `reference_type='admin_action'`). NOTE : `stock_movements` is append-only ; but post-INSERT UPDATE of `reference_type`/`reference_id` is required for the JE trigger linkage. **Better**: pass via `p_metadata` and modify trigger ? Trigger already references `NEW.id` for `reference_id` → so the JE will have `reference_type='stock_movement'` and `reference_id = movement_id` (NOT production_id). For revert lookup we use `metadata->>'production_id' = v_production_id::text` instead. Movements table never gets UPDATEd. ✅ Confirmed append-only respected.
12. For each recipe row, call `record_stock_movement_v1` for `production_out` :
    - `p_quantity = -consumed_in_material_unit`
    - `p_unit = material.unit`
    - `p_reason = 'Material consumed by ' || production_number`
    - `p_from_section_id = p_section_id`
    - `p_metadata = jsonb_build_object('production_id', v_production_id, 'material_id', recipe.material_id)`
    - `p_lot_id = NULL` (let RPC resolve FIFO if F1-tracked)
    - `p_idempotency_key = NULL`
13. UPDATE production_records SET `materials_consumed=true, stock_updated=true`.
14. **Verify JE was posted** : `SELECT COUNT(*) FROM journal_entries WHERE reference_type='stock_movement' AND reference_id IN (movement ids)`. If `>= 1`, SET `je_posted=true`.
15. Return JSONB : `{production_id, production_number, lot_id, movements_count, je_count, idempotent_replay:false}`.

**Acceptance / pgTAP**
- T_PROD_08 CASHIER → `forbidden`.
- T_PROD_09 MANAGER + qty=0 → `quantity_must_be_positive`.
- T_PROD_10 MANAGER + insufficient_stock → `insufficient_stock` ERRCODE P0002 (DETAIL contains missing material name).
- T_PROD_11 MANAGER + valid → INSERT production_records row + N+1 stock_movements + ≥ N+1 journal_entries via trigger.
- T_PROD_12 idempotency replay → same `production_id`, no duplicate movements.

**Commit** : `feat(db): session 13 — phase 2.A — record_production_v1 RPC`

### Task D — Migration `000064` (`revert_production_v1` + patch trigger) + pgTAP T_PROD_13..14

**Files**
- `supabase/migrations/20260517000064_create_revert_production_rpc.sql` (CREATE) — includes `CREATE OR REPLACE FUNCTION tr_stock_movement_je()` with `metadata->>'reverse_of_production'='true'` early-return guard, and the new RPC `revert_production_v1`.
- `supabase/tests/inventory_production.test.sql` (APPEND T_PROD_13..14)

**Logic** (per D-2A-9, D-2A-14)
- Permission gate `inventory.production.delete` (ADMIN+).
- RAISE `production_not_found` if no row, or `already_reverted` if `reverted_at IS NOT NULL`, or `production_too_old` if `production_date < now() - INTERVAL '24 hours'`.
- For each original movement (looked up via `metadata->>'production_id' = p_production_id::text`), INSERT a reverse row directly into `stock_movements` (qty negated, same movement_type, metadata `{reverse_of_production: true, original_movement_id: ...}`). **Direct INSERT is permitted here** because the trigger function ignores rows with the reverse flag, and the stock_movements RLS denies UPDATE/DELETE only — INSERT is allowed for SECURITY DEFINER functions running as owner.

Wait — `stock_movements` RLS revokes INSERT/UPDATE/DELETE from `authenticated` but SECURITY DEFINER bypasses RLS by running as owner. ✅ OK.

- Re-credit lot if produced lot present : `UPDATE stock_lots SET quantity=0, status='consumed' WHERE id=<the production_in's lot_id>`. (Reverse direction is informational — we don't restore quantity ; the lot is voided.)
- INSERT a counter-JE block : one journal_entry with reverse DR/CR for each original JE referenced from those movements. Set `journal_entries.metadata={reverse_of_production: true, original_je_id: ...}`.
- UPDATE production_records SET `reverted_at=now(), reverted_by=v_profile, je_posted=false, stock_updated=false, materials_consumed=false`.
- Return JSONB `{production_id, reverse_movements_count, reverse_je_count}`.

**Acceptance / pgTAP**
- T_PROD_13 MANAGER → `forbidden`.
- T_PROD_14 ADMIN happy-path : original production + revert → `current_stock` returns to pre-production level for the finished product AND for each material ; balanced reversal JE exists.

**Commit** : `feat(db): session 13 — phase 2.A — revert_production_v1 RPC + trigger reverse-guard`

### Task E — Migration `000065` (`get_production_suggestions_v1`) + pgTAP T_PROD_15

**Files**
- `supabase/migrations/20260517000065_create_production_suggestions_rpc.sql` (CREATE)
- `supabase/tests/inventory_production.test.sql` (APPEND T_PROD_15)

**RPC signature**
```sql
get_production_suggestions_v1(
  p_lookback_days  INT DEFAULT 7,
  p_priority_high  INT DEFAULT 3,
  p_priority_medium INT DEFAULT 7
) RETURNS TABLE(
  product_id UUID, product_name TEXT, avg_daily_sales DECIMAL,
  current_stock DECIMAL, days_of_stock DECIMAL,
  suggested_quantity DECIMAL, priority TEXT
) SECURITY DEFINER
```

**Logic** : as D-2A-10. Filters finished + has-active-recipe + avg_daily_sales > 0.

**Acceptance**
- T_PROD_15 MANAGER : suggestions returns ≥ 1 row for a seeded finished product with recent sales + active recipe.

**Commit** : `feat(db): session 13 — phase 2.A — get_production_suggestions_v1 RPC`

### Task F — Migration `000066` (`view_product_recipes`)

**File**
- `supabase/migrations/20260517000066_init_view_product_recipes.sql` (CREATE — view with `security_invoker=true`).

**Acceptance**
- Querying the view as MANAGER returns rows ; as anon returns 0 rows.

**Commit** : `feat(db): session 13 — phase 2.A — view_product_recipes`

### Task G — Vitest live RPC : full 50-baguette cycle

**File**
- `supabase/tests/functions/inventory-production.test.ts` (CREATE)

**Scenario**
1. Create test products (baguette finished + 4 raw materials : flour, salt, yeast, water) with seeded `cost_price` and `current_stock` large enough.
2. As ADMIN : upsert 4 recipe rows for baguette.
3. As MANAGER : `record_production_v1(baguette, 50, section_id, 'BATCH-001')` — expect success.
4. Assertions :
   - `production_records` row created with `production_number` matching `PROD-YYYYMMDD-XXXX`.
   - 5 `stock_movements` rows : 1 `production_in` (+50 baguettes), 4 `production_out` (negative qty for each material).
   - `journal_entries` count ≥ 1 with `reference_type='stock_movement'` for each movement.
   - Sum of DR-side accounts balances CR-side (per movement).
5. Idempotency : same call with same `p_idempotency_key` returns same `production_id`.
6. Revert as ADMIN : `revert_production_v1(production_id, 'test reversal')` → finished stock back to pre-production level + materials back to pre-production level.

**Acceptance**
- Test runs green via `pnpm --filter @breakery/supabase test inventory-production`. (NB: the supabase tests filter is configured in workspace ; verify path before running).

**Commit** : `test(supabase): session 13 — phase 2.A — Vitest live 50-baguette full cycle`

### Task H — Domain helpers + unit tests

**Files**
- `packages/domain/src/production/index.ts` (CREATE — barrel)
- `packages/domain/src/production/types.ts` (CREATE — types only)
- `packages/domain/src/production/recipeExpansion.ts` (CREATE — `expandRecipe(recipe, multiplier)` returns scaled rows with unit converter)
- `packages/domain/src/production/bomResolver.ts` (CREATE — flatten recipe rows + sum cost = `bomCost(recipe, costMap)`)
- `packages/domain/src/production/__tests__/recipeExpansion.test.ts` (CREATE)
- `packages/domain/src/production/__tests__/bomResolver.test.ts` (CREATE)

**Acceptance** : pure-TS, IO-free, Vitest unit tests pass.

**Commit** : `feat(domain): session 13 — phase 2.A — recipe expansion + BoM resolver`

### Task I — BO hooks + components + page

**Files** (under `apps/backoffice/src/features/inventory-production/` unless noted)
- `hooks/useProductionRecords.ts` (CREATE — list with date filter)
- `hooks/useProductionDetail.ts` (CREATE)
- `hooks/useRecordProduction.ts` (CREATE — mutation w/ idempotencyKey)
- `hooks/useRevertProduction.ts` (CREATE)
- `hooks/useProductionSuggestions.ts` (CREATE)
- `hooks/useRecipes.ts` (CREATE — list via `view_product_recipes` filtered by product_id)
- `hooks/useUpsertRecipe.ts` (CREATE — mutation)
- `hooks/useDeactivateRecipe.ts` (CREATE — mutation)
- `components/ProductionForm.tsx` (CREATE)
- `components/ProductionRecordList.tsx` (CREATE)
- `components/ProductionDetail.tsx` (CREATE)
- `components/ProductionSuggestions.tsx` (CREATE)
- `components/RevertProductionDialog.tsx` (CREATE)
- `components/RecipeEditor.tsx` (CREATE — table editable w/ add row)
- `components/RecipeRow.tsx` (CREATE)
- `components/FeasibilityBadge.tsx` (CREATE — light : feasible/tight/insufficient indicator)
- `__tests__/RecipeEditor.smoke.test.tsx` (CREATE — render + add row + save mock)
- `__tests__/ProductionForm.smoke.test.tsx` (CREATE — render + submit mock)
- `apps/backoffice/src/pages/inventory/ProductionPage.tsx` (CREATE)
- `apps/backoffice/src/pages/inventory/RecipeEditorPage.tsx` (CREATE)
- `apps/backoffice/src/routes/index.tsx` (UPDATE — add 2 routes : `inventory/production` and `inventory/recipes` with PermissionGate `inventory.read` for read, `inventory.production.create` for production submit which is checked in form, `inventory.recipes.update` for recipes edit).
- `apps/backoffice/src/layouts/BackofficeLayout.tsx` (UPDATE — add 2 sidebar entries OR mark TODO if cap concern. Decision : add 1 "Production" parent + 1 "Recipes" entry under inventory. Keep it flat as Phase 2 in session 12 — add **as direct sidebar entries** `Production` and `Recipes` under the existing `Inventory` slot. NAV is a flat list ; we'll add 2 new items.)

**Acceptance**
- All hooks compile, smoke tests pass.
- `pnpm --filter @breakery/backoffice test inventory-production` is green.
- Page renders ; sidebar shows Production + Recipes.

**Commit** : `feat(backoffice): session 13 — phase 2.A — ProductionPage + RecipeEditor + hooks`

### Task J — Types regen + final verify + deviation note

**Steps**
1. Regen types via `mcp__plugin_supabase_supabase__generate_typescript_types` → write to `packages/supabase/src/types.generated.ts`.
2. `pnpm typecheck` (root) — must be green.
3. `pnpm --filter @breakery/supabase test inventory-production` — green.
4. `pnpm --filter @breakery/backoffice test inventory-production` — green.
5. `pnpm --filter @breakery/domain test production` — green.
6. Append section to `docs/workplan/refs/2026-05-13-session-13-wave-2-deviations.md` (CREATE if absent) describing :
   - Perm name reuse (`recipes.update`, `production.delete` instead of spec's `recipes.manage`, `production.revert`).
   - Reverse-of-production guard via `tr_stock_movement_je()` patch + explicit counter-JE.
   - No `production_waste` movement (waste matter consumed via inflated material qty).
   - F1 lot reverse : no per-lot re-credit on revert (lot voided, no quantity restore).

**Commit** : `chore(types): regen types.generated.ts post-phase-2.A + deviations note`

## 4. Verification (one-shot before reporting DONE)

```bash
pnpm typecheck
pnpm --filter @breakery/domain test production
pnpm --filter @breakery/supabase test inventory-production
pnpm --filter @breakery/backoffice test inventory-production
pnpm build
```

pgTAP run via MCP `execute_sql` :
```sql
BEGIN;
\i supabase/tests/inventory_production.test.sql
ROLLBACK;
```
— but since we use MCP, we paste the body in `execute_sql` with `BEGIN ... ROLLBACK` envelope.

## 5. Phase 2.A closing gate (DoD echo)

- [ ] 7 migrations applied via MCP `apply_migration`, verified in `list_migrations`.
- [ ] types.generated.ts regenerated + committed.
- [ ] pgTAP T_PROD_01..15 green.
- [ ] Vitest live 50-baguette full cycle green : 1 `production_in` + 4 `production_out` + ≥ 5 JEs balanced (DR=CR per JE).
- [ ] `record_production_v1` calls `create_stock_lot_v1` UPFRONT when `default_shelf_life_hours` set on the produced product.
- [ ] Insufficient stock → P0002 with missing items in DETAIL.
- [ ] Revert (ADMIN+) reverses stock + JEs ; lots voided.
- [ ] ProductionPage + RecipeEditor renderable ; smoke tests pass.
- [ ] `view_product_recipes` queryable.
- [ ] Sidebar shows Production + Recipes entries.
- [ ] CI grep gate (`has_permission` re-CREATE block) untouched — verified by `grep -E "(CREATE OR REPLACE|CREATE) +FUNCTION +(public\\.)?has_permission\\b" supabase/migrations/20260517000060_*.sql supabase/migrations/20260517000061_*.sql ... = 0 hits`.
- [ ] All commits squash-mergeable with format `feat(<scope>): session 13 — phase 2.A — <topic>` + Claude co-author.

## 6. Reporting

When DONE : SendMessage(`lead`) with migration list, test counts, commit SHAs, link to deviations note.
