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
