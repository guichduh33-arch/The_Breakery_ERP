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
