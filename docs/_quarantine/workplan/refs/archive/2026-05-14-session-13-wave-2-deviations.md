# Session 13 — Wave 2 Deviation Pack

**Date opened:** 2026-05-14
**Status:** open — appended as Wave 2 phases land.

This document records intentional deviations between the Wave 2 INDEX/spec
and the SQL/code that actually landed on staging `ikcyvlovptebroadgtvd` and
in the repo. Each entry covers cause + resolution + verification, mirroring
the Wave 1 deviation pack format.

---

## D-W2-2C-01 — POS hook is `useEvaluatePromotions.ts`, not `usePromotionEvaluation.ts`

**INDEX line 555 says:** `apps/pos/src/features/promotions/hooks/usePromotionEvaluation.ts` (UPDATE)
**Real file path:** `apps/pos/src/features/promotions/hooks/useEvaluatePromotions.ts`

### Cause
The INDEX referenced a never-created file name. Session 9 (2026-05-10)
shipped the hook with the verb-noun convention used elsewhere in the POS
(`useFetchProducts`, `useCreateOrder` etc.), producing `useEvaluatePromotions`.

### Resolution
We **kept** the existing name — renaming would touch every consumer
(`usePromotionsAutoEval`, smoke tests, ActiveOrderPanel) for zero gain.
Phase 2.C updates the existing hook in place to call `evaluate_promotions_v1`
RPC first and fall back to the pure-TS engine on RPC failure.

### Verification
- `grep -RE "useEvaluatePromotions|usePromotionEvaluation" apps/pos/src` shows
  only `useEvaluatePromotions` references in the codebase.

---

## D-W2-2C-02 — Cart store is `apps/pos/src/stores/cartStore.ts`, not `features/cart/store/cartStore.ts`

**INDEX line 556 says:** `apps/pos/src/features/cart/store/cartStore.ts`
**Real file path:** `apps/pos/src/stores/cartStore.ts`

### Cause
INDEX assumed a feature-grouped Zustand store layout. The POS uses a flat
`src/stores/` directory (`cartStore`, `staffStore`, etc.) — convention from
Session 2 bootstrap.

### Resolution
Phase 2.C **does not modify** `cartStore.ts`. Instead, the RPC return is
normalized to the existing `AppliedPromotion[]` shape inside
`useEvaluatePromotions.ts`. The cart store's `setAppliedPromotions` action
consumes the same shape unchanged ⇒ no migration of state required.

### Verification
- `pnpm --filter @breakery/pos test cart` continues to pass without changes
  to `cartStore.test.ts`.
- `setAppliedPromotions` signature unchanged.

---

## D-W2-2C-03 — BogoForm / ThresholdForm are sub-component blocks, not separate modals

**INDEX line 557 says:** `apps/backoffice/src/features/promotions/components/BogoForm.tsx (CREATE) + ThresholdForm.tsx (CREATE)`

### Cause
The existing BO promotions admin UI flows through `PromotionFormModal` →
shared `@breakery/ui/PromotionForm` (3-tab General/Conditions/Stacking
layout). Creating two parallel modals for BOGO and Threshold would:
1. duplicate the conditions+stacking tabs,
2. require a new entry point in `PromotionListPage` (two new "Create" buttons),
3. fork the mutation hooks (`useCreatePromotion`/`useUpdatePromotion`) per
   shape ⇒ extra ref-data plumbing.

### Resolution
Both files exist as **sub-component blocks** rendered conditionally inside
the existing `PromotionForm` Type tab when `values.type === 'bogo' &&
values.bogo_buy_quantity !== null` (new shape) or `values.type ===
'threshold'`. Saving goes through the existing `useCreatePromotion`/
`useUpdatePromotion` mutations — they pass the full `PromotionFormValues`
through to Supabase as a single insert/update.

### Verification
- `apps/backoffice/src/features/promotions/components/BogoForm.tsx` exists
  and exports a JSX block (`BogoFields`).
- `apps/backoffice/src/features/promotions/components/ThresholdForm.tsx`
  same.
- `PromotionFormModal.tsx` unchanged (still delegates to shared
  `PromotionForm`).
- BO smoke tests (`apps/backoffice/src/features/promotions/__tests__/*`)
  cover both render + save.

---

## D-W2-2C-04 — `promotion_type` enum extended with `'threshold'` and `'bundle'`

**INDEX line 550 implies:** Only new *columns* are needed on `promotions`.

### Cause
Threshold and bundle promotions need a discriminator that is *not* "bogo
with extra columns". Putting them under `type='bogo'` would force every
matcher branch (TS + SQL) to inspect `threshold_amount IS NOT NULL` /
`bundle_product_ids IS NOT NULL` to disambiguate — fragile and error-prone.

### Resolution
Migration `20260517000080_extend_promotions_schema_bogo_threshold.sql`
adds `'threshold'` and `'bundle'` values to the `promotion_type` enum via
`ALTER TYPE … ADD VALUE IF NOT EXISTS`, alongside the column additions.
The CHECK constraint `chk_promotion_type_fields` is replaced (DROP +
CREATE) to require the right field combination per type:
- `'percentage' | 'fixed_amount'` → `discount_value IS NOT NULL AND scope IS NOT NULL`.
- `'bogo'` legacy → arrays + qty + reward_pct populated.
- `'bogo'` new shape → `bogo_buy_quantity IS NOT NULL AND bogo_get_quantity IS NOT NULL AND bogo_get_product_id IS NOT NULL`.
- `'threshold'` → `threshold_amount IS NOT NULL AND threshold_type IS NOT NULL AND discount_value IS NOT NULL`.
- `'bundle'` → `bundle_product_ids IS NOT NULL AND array_length(bundle_product_ids,1) >= 2 AND bundle_price IS NOT NULL`.
- `'free_product'` → `gift_product_id IS NOT NULL`.

### Verification
- `SELECT unnest(enum_range(NULL::promotion_type))` lists 6 values
  (percentage, fixed_amount, bogo, free_product, threshold, bundle).
- pgTAP T_BOGO_06 (bundle) and T_BOGO_04/05 (threshold) assert insert +
  evaluate + discount math.

---

## D-W2-2C-06 — Migration 000080 split into 000080 (enum) + 000081 (columns + CHECK)

**INDEX line 549-550 implies:** Three migrations `000080..000082`.
**Actual deployment:** Four migrations `000080..000083`.

### Cause
Postgres requires `ALTER TYPE … ADD VALUE` to be committed before the new
enum value can be referenced inside any expression (e.g. a CHECK
constraint that mentions `type = 'threshold'`). MCP `apply_migration`
wraps each call in a transaction ⇒ enum + CHECK referencing the new value
cannot land in the same migration.

### Resolution
- `20260517000080_extend_promotions_schema_bogo_threshold.sql` — Part 1/2,
  enum-only (`ALTER TYPE … ADD VALUE IF NOT EXISTS 'threshold'`, `'bundle'`).
- `20260517000081_extend_promotions_columns_phase_2c.sql` — Part 2/2,
  column additions + index + replacement `chk_promotion_type_fields`.
- `20260517000082_create_evaluate_promotions_v1.sql` — function (was 000081).
- `20260517000083_seed_demo_bogo_promotion.sql` — seed (was 000082).

Staging migration log shows both halves committed (`extend_promotions_schema_bogo_threshold`
+ `extend_promotions_columns_phase_2c`) as separate rows.

### Verification
- `SELECT unnest(enum_range(NULL::promotion_type))` returns 6 values.
- `\d promotions` shows the 7 new columns + index.
- `pg_get_constraintdef('chk_promotion_type_fields')` includes the new
  branches for `threshold` and `bundle` and both BOGO shapes.

---

## D-W2-2C-05 — Added `bundle_price DECIMAL(14,2)` column not in INDEX

**INDEX line 550 lists:** `bundle_product_ids UUID[] NULL` only.

### Cause
A bundle promo needs a target price (e.g. "buy croissant + coffee + jus for
50k instead of 70k"). Without a `bundle_price` column, the discount
amount is undefined.

### Resolution
Added `bundle_price DECIMAL(14,2) NULL CHECK (bundle_price IS NULL OR
bundle_price >= 0)` in migration `20260517000080`. SQL function computes
`discount = matched_subtotal - bundle_price` when both are present.

### Verification
- `\d promotions` shows `bundle_price` column.
- T_BOGO_06 asserts `discount = 20k` for a cart of 70k worth of 3 bundle
  items + `bundle_price = 50k`.

---

## D-W2-2D-01 — Opname finalize uses `opname_in` / `opname_out` (not `opname_adjust_up` / `opname_adjust_down`)

**Phase 2.D spec says:** `finalize_opname_v1` emits movements with
`movement_type='opname_adjust_up'` (variance > 0) or
`movement_type='opname_adjust_down'` (variance < 0).

### Cause

`tr_20_je_emit` (Phase 1.A migration `20260517000022`) is already wired to
post journal entries for the existing enum values `opname_in` and
`opname_out` (seeded by `20260516000014_extend_movement_type_enum.sql`).
Adding `opname_adjust_up` / `opname_adjust_down` would have required :

1. extending `movement_type` enum in a separate Phase-2.D migration (enum
   `ALTER TYPE … ADD VALUE` cannot be used in the same transaction as
   references — see D-W2-2C-04 for the same pattern),
2. extending the JE trigger's CASE statement with two new branches,
3. extending the section-stock-direction CHECK constraint
   (`chk_stock_movements_section_required`) since the new names aren't
   in the exemption list.

The semantics are identical and the JE mappings already match :
`OPNAME_INCOME` (CR on positive variance) and `OPNAME_EXPENSE` (DR on
negative variance) → no behavioural diff between the two naming schemes.

### Resolution

`finalize_opname_v1` (migration `20260517000091`) emits :
- `opname_in` for positive variance (`v_item.variance > 0`), `p_quantity = ABS(variance)`,
  `p_to_section_id = count.section_id` → DR INVENTORY_GENERAL / CR OPNAME_INCOME.
- `opname_out` for negative variance, `p_quantity = -ABS(variance)`,
  `p_from_section_id = count.section_id` → DR OPNAME_EXPENSE / CR INVENTORY_GENERAL.

After insert, the movement row is patched with `reference_type='opname'` +
`reference_id=count_id` so the audit trail and the JE both link back to
the count.

### Verification

- Manual workflow validation in `BEGIN ... ROLLBACK` envelope on staging
  (`ikcyvlovptebroadgtvd`) : inserted a synthetic `opname_out` movement
  with `quantity=-5`, `unit_cost=NULL`, `cost_price=5000` → JE row created
  by `tr_20_je_emit` with `total_debit = total_credit = 25000`.
- Vitest live `T_OPN_LIVE_03` (`inventory-opname.test.ts`) asserts the
  full cycle end-to-end : 1 movement emitted, JE balanced at 25k, metadata
  `movement_type=opname_out`.
- pgTAP `T_OPN_11` (`inventory_opname.test.sql`) asserts both enum values
  are present.


---

## D-W2-2A-01 — Perm name reuse: `inventory.recipes.update` and `inventory.production.delete` (not the spec's `.manage` / `.revert`)

**Spec line 452 / 456 says:** "manager+ INSERT/UPDATE via `has_permission('inventory.recipes.manage')`" and `revert_production_v1` ADMIN+ gated by `inventory.production.revert`.
**Actual perms used:** `inventory.recipes.update` (already seeded, granted SUPER_ADMIN/ADMIN; Phase 2.A migration 000060 adds MANAGER) and `inventory.production.delete` (already seeded SUPER_ADMIN/ADMIN — no change).

### Cause
Permissions table already had `inventory.recipes.update` (MANAGER+) and `inventory.production.delete` (ADMIN+) seeded in earlier phases. Introducing `.manage` / `.revert` would have required either (a) re-seeding + role grants (extra migrations, drift risk) or (b) violating the CLAUDE.md rule that `has_permission()` must not be re-CREATED.

### Resolution
Reuse the existing perms. Semantics unchanged: `recipes.update` covers upsert + deactivate (MANAGER+); `production.delete` covers revert (ADMIN+). Migration 000060 INSERTs into `role_permissions` to grant `inventory.recipes.update` to MANAGER with `ON CONFLICT DO NOTHING`. No `has_permission` re-CREATE.

### Verification
- `SELECT role_code FROM role_permissions WHERE permission_code='inventory.recipes.update'` returns SUPER_ADMIN, ADMIN, MANAGER.
- `SELECT role_code FROM role_permissions WHERE permission_code='inventory.production.delete'` returns SUPER_ADMIN, ADMIN (unchanged).
- pgTAP T_PROD_06 (cashier upsert recipe → forbidden) and T_PROD_13 (manager revert → forbidden) pass.

---

## D-W2-2A-02 — Reverse-of-production discriminant on `tr_stock_movement_je()` (migration 000064 patches the trigger)

**Spec line 456 says:** "INSERT reverse stock_movements (negate quantities, movement_type='production_in_reversal' / 'production_out_reversal')".

### Cause
Adding `production_in_reversal` / `production_out_reversal` to the `movement_type` enum is invasive (cross-phase risk) and the trigger's CASE statement would need a new pair of mappings. Worse, the trigger emits JEs based on movement_type + uses ABS(quantity) for value — even with the negated quantity, the trigger would emit a JE in the SAME DR/CR direction as the original (wrong).

### Resolution
Migration 000064:
1. Patches `tr_stock_movement_je()` (CREATE OR REPLACE — not has_permission) with an early-return guard `IF NEW.metadata->>'reverse_of_production' = 'true' THEN RETURN NEW; END IF;`.
2. `revert_production_v1` directly INSERTs reverse stock_movements with the SAME movement_type, negated quantity, and `metadata.reverse_of_production=true` flag. The trigger then skips JE emission.
3. The RPC INSERTs explicit counter-JEs with debit/credit columns swapped from the original journal_entry_lines. JE.metadata.movement_type uses a discriminant `'reversal:' || original_movement_type || ':' || original_je_id` to satisfy the journal_entries_je_idempotency_uniq UNIQUE index.

The append-only `stock_movements` invariant is respected (counter-rows INSERTed; no UPDATEs).

### Verification
- Staging dry-run: production 50 baguettes + revert → original DR=200k, CR=200k, reversal DR=200k, CR=200k → net=0 across all accounts.
- pgTAP T_PROD_13 (manager → forbidden) and T_PROD_14 (admin revert restores stock + balanced ledger) pass.

---

## D-W2-2A-03 — `journal_entries.reference_type` uses `'production'` for reversal JEs (not `'production_reversal'`)

**Sub-plan §2 D-2A-9 originally said:** Counter-JEs use `reference_type='production_reversal'`.

### Cause
The `journal_entries_reference_type_check` constraint enumerates allowed values: sale, sale_void, sale_refund, purchase, purchase_return, purchase_payment, expense, expense_payment, shift_close, adjustment, waste, opname, production, transfer, manual, pos_outstanding, pos_outstanding_payment, stock_movement, void, refund. `production_reversal` is not in the list. Extending the CHECK would require dropping and recreating it; we keep the constraint stable in Phase 2.A.

### Resolution
Counter-JEs use `reference_type='production'` + `reference_id=<production_id>` + `metadata.reverse_of_production=true`. Both original-side and reversal-side JEs reference the production_id, but originals have `reference_type='stock_movement'` (set by the trigger), while reversals have `reference_type='production'` (set by revert_production_v1). The two are easily distinguishable in queries.

### Verification
- Querying `journal_entries WHERE reference_id=<production_id>` returns the reversal JEs only; querying joined via stock_movements returns the originals.

---

## D-W2-2A-04 — `production_records.quantity_waste` does NOT emit a separate `production_waste` movement

**Module 15 ref §6 / §13 implies:** waste is a separate movement type alongside production_in / production_out.

### Cause
V3's `movement_type` enum doesn't have `production_waste`. Adding it would require a cross-phase enum extension. More importantly, the simpler model used here is correct: the matter consumed for waste-bound bread DID exit raw material stock, so `production_out` already covers it; the only thing waste does NOT do is credit finished-goods stock.

### Resolution
- `record_production_v1` includes `quantity_waste` in the recipe multiplier when computing material consumption (`p_quantity_produced + p_quantity_waste`). The N production_out movements consume the full amount including waste.
- The `production_in` movement adds ONLY `p_quantity_produced` (waste is NOT vendable, NOT added to finished-goods stock).
- `production_records.quantity_waste` is kept as-is for reporting (waste rate per product per day).

### Verification
- A production of 50 + 2 waste (52 total) with 250g flour/unit consumes 52 × 250g = 13kg flour, but only adds 50 baguettes to finished stock. Verified via direct SQL on staging.

---

## D-W2-2A-05 — F1 lot reverse: produced lot voided (status=consumed, quantity=0); material lots not per-lot re-credited

**Sub-plan §2 D-2A-9 says:** "For lots: if the production created a stock_lots row, set stock_lots.status='consumed' and stock_lots.quantity=0."

### Cause
On revert, the reversal stock_movements increment material stock via `products.current_stock` directly — they do NOT re-credit a specific lot the FIFO resolver had decremented. Restoring per-lot quantities on revert would require us to track which lot(s) each `production_out` consumed (the FIFO resolver locks a single lot — see migration 000020), then re-credit that lot row.

### Resolution
For Phase 2.A MVP, the **produced** lot (the `stock_lots` row created by the production_in side via `create_stock_lot_v1`) is voided on revert: `quantity=0, status='consumed'`. The **consumed** material lots are NOT touched — the reversal lands as a non-lot positive stock_movement on the material side. Material stock totals are restored at the `products.current_stock` level (verified via T_PROD_14), but per-lot reconciliation is deferred.

### Acceptance
Acceptable for MVP because:
- Production-output lots are voided correctly (the typical case for F1-tracked products).
- Material-side lots are usually less time-sensitive (kg of flour rarely under F1 in V3 seed).
- A Phase X follow-up can add per-lot revert when the lot consumption mapping is recorded in stock_movements.metadata.

### Verification
- T_PROD_14 (admin revert) asserts `products.current_stock` is fully restored on both finished and material sides.
- For F1-tracked finished products, `stock_lots WHERE id=<produced_lot_id>` shows `status='consumed', quantity=0` after revert.

---

## D-W2-2A-06 — `products.product_type` CHECK only allows {finished, combo}; no separate `raw_material` type

**Module 15 ref §17 says:** Recipes have a `material_id` that points to a `products.id` which can be `raw_material` or `semi_finished`.

### Cause
The V3 `products_product_type_check` constraint enumerates only `'finished'` and `'combo'` (verified via `pg_get_constraintdef`). Raw materials live in the `products` table but are typed as `'finished'`. The distinction is conveyed via category, not via product_type.

### Resolution
Recipes (and tests / fixtures) reference materials as `product_type='finished'` — the FK is simply `products(id)` with no type filter. This works correctly with `record_production_v1` and `convert_quantity` because both operate on `products.unit` / `products.cost_price` regardless of the conceptual product class. The semantic distinction (raw_material vs finished goods) is left to category-based reporting.

### Verification
- pgTAP fixtures use SKU prefix `T_PROD_*` for all materials with `product_type='finished'`.
- 50-baguette live test on staging completed successfully with all 5 products typed `'finished'`.
