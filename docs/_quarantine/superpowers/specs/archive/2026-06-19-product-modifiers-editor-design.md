# Product Modifiers Editor (Backoffice) — Design Spec

- **Date**: 2026-06-19
- **Branch**: `swarm/session-48`
- **Status**: Approved design — ready for implementation plan
- **Scope**: Phase 1 of 2 (this spec). Phase 2 (stock deduction wiring) is deferred to a separate spec.

## Problem

Products need configurable **variant types** whose selection automatically adjusts
the price. Example given by the owner:

- Variant type **Milk** → `Fresh milk` (default), `Oat milk` (+10 000 IDR)
- Variant type **ICE/HOT** → `Ice`, `Hot`

The customer picks one option per type; the line price adjusts automatically; the
item is still sold as **one line**.

## Key finding — the behaviour already exists at the POS

This is exactly the project's existing **modifiers** system, not the S27c
"Variants" feature (which models *separate sellable products* with their own
SKU/price/stock).

| Owner's vocabulary | `product_modifiers` table column |
|---|---|
| Variant type (Milk, ICE/HOT) | `group_name` + `group_type` (`single_select` / `multi_select`) + `group_required` |
| Variant option (Fresh milk, Oat milk, Ice, Hot) | `option_label` |
| +10 000 IDR on Oat milk | `price_adjustment` |
| Default option | `is_default` |
| Stock to deduct per option | `ingredients_to_deduct` (JSONB) |

What already exists and is **not** being rebuilt:

- DB table `product_modifiers` (group/option columns, soft-delete, GIN index).
- RPC `upsert_product_modifiers_v1(p_product_id UUID, p_groups JSONB)` — S27,
  SECURITY DEFINER, gate `products.modifiers.update`, clean-slate soft-delete +
  revive on `ON CONFLICT (product_id, category_id, group_name, option_label)`,
  audit `product.modifiers`, canonical anon REVOKE pair.
- Permission `products.modifiers.update` (S27, in the `PermissionCode` union).
- POS consumption: `ModifierModal` (`@breakery/ui`) + `useProductModifiers`
  (`apps/pos`) open a modal at product tap, apply `price_adjustment` to the line,
  sell as one line. `multi-modifier.smoke.test.tsx` covers it.
- Domain module `@breakery/domain/modifiers`: `ModifierGroupType`,
  `ModifierOption`, `ModifierGroupOption`, `ModifierGroup`, `ProductModifierRow`,
  `mergeGroups`, `calculatePriceAdjustment`, `validateSelections`.

What is **missing** (this spec): the Backoffice authoring UI. The RPC has **no UI
consumer** — there is no "Modifiers" tab on the product detail page.

## Critical scope decision — stock deduction is currently inert

The `ingredients_to_deduct` column is **written but never read**. Its documented
shape (column comment) is `Array of {product_id UUID, qty NUMERIC, unit TEXT}`.
The money-path RPCs (`complete_order_with_payment_v13`, `pay_existing_order_v9`,
`fire_counter_order_v3`) read the chosen `modifiers[]` to **adjust price** but do
**not** deduct per-option ingredient stock; the reversals (void/refund) likewise
do not restore it.

Therefore the work is split:

- **Phase 1 (this spec)** — Backoffice editor that authors groups/options/price/
  default/required **and captures `ingredients_to_deduct` per option** (persisted
  via the existing RPC). Delivers price-per-variant end-to-end immediately
  (POS already applies it). The captured ingredient data is stored but not yet
  consumed.
- **Phase 2 (separate spec, deferred)** — wire real stock deduction into the
  money-path RPCs (`v13→v14`, `v9→v10`, `v3→v4`) + reversals + pgTAP.

## Goals (Phase 1)

1. A **"Modifiers"** tab on `ProductDetailPage` to create/edit/delete a product's
   modifier groups and options.
2. Support both **single_select** and **multi_select** groups.
3. Per option: `option_label`, `price_adjustment` (IDR), `is_default`, and an
   `ingredients_to_deduct` editor (raw-material picker + qty + unit).
4. Persist via `upsert_product_modifiers_v1`; price-per-option works at the POS
   without any further change.
5. Gate the Save action on `products.modifiers.update`.

## Non-goals (Phase 1)

- Real stock deduction at order time (Phase 2 — money-path RPC bumps + reversals).
- Category-level modifier authoring (the RPC is product-scoped; the POS still
  *reads* category-level rows, but authoring stays product-scoped in v1).
- Drag-and-drop reordering of groups/options (use a numeric/sequential order;
  DnD deferred).
- Option icons (`option_icon`) authoring.
- Live browser verification (optional, not required to ship).
- Any DB migration or types regen (no schema change).

## Architecture

Backoffice-only. No DB migration. No types regen (the generated types already
include `product_modifiers`).

### Placement

- Add `'modifiers'` to the `ProductDetailTab` union (`apps/backoffice/src/features/products/types.ts`).
- Add `{ id: 'modifiers', label: 'Modifiers' }` to `ProductDetailTabs.tsx`
  (placed after `'variants'`).
- Render `<ModifiersPanel product={p} />` in `ProductDetailPage.tsx` when
  `tab === 'modifiers'`. The tab is product-scoped via `product.id`.

### Components (one purpose each)

- **`ModifiersPanel`** (`apps/backoffice/src/features/products/components/ModifiersPanel.tsx`)
  Orchestrator. Loads existing modifiers, holds the editable draft
  (`groups[]`), tracks a dirty flag, renders the group list, "Add group", and a
  **Save** button. Save is hidden/disabled without `products.modifiers.update`.
  On save: validate → assemble JSONB → call the upsert hook → on success reset
  dirty + invalidate query.

- **`ModifierGroupCard`** — one variant type. Fields: `group_name` (text),
  `group_type` via a native `<select>` (Single / Multi — `@breakery/ui` exports
  no `Select`), `group_required` toggle, a sequential order, list of options,
  "Add option", and "Remove group".

- **`ModifierOptionRow`** — one option. Fields: `option_label` (text),
  `price_adjustment` (number, IDR), `is_default` (radio within a single_select
  group; checkbox within a multi_select group), "Remove option", and an
  embedded `OptionIngredientPicker`.

- **`OptionIngredientPicker`** — edits `ingredients_to_deduct`: rows of
  `{ product_id (raw material), qty, unit }`. The raw-material list reuses the
  `category_type='raw_material'` filtering pattern from `useAllProductsForPO`
  (a focused BO hook). Unit defaults to the chosen material's base unit;
  `qty > 0`.

### Hooks

- **`useProductModifiersAdmin(productId)`**
  `SELECT` from `product_modifiers` where `product_id = productId`, `is_active`,
  `deleted_at IS NULL`, including `ingredients_to_deduct`. Folds the flat rows
  into editable groups (an admin-side fold that preserves **all** authored fields
  — `mergeGroups` drops `ingredients_to_deduct`/`option_icon`, so the panel uses
  a dedicated fold). Query key `['product-modifiers-admin', productId]`.

- **`useUpsertProductModifiers(productId)`**
  Calls `supabase.rpc('upsert_product_modifiers_v1', { p_product_id, p_groups })`.
  Invalidates `['product-modifiers-admin', productId]` and the POS-shared
  `['product-modifiers', …]` keys. The RPC is bound (`supabase.rpc`), never a
  raw insert.

- **`useRawMaterialsForModifiers()`** (or reuse an existing raw-material hook)
  Lists `category_type='raw_material'` products (id, name, base unit, alt units)
  for the ingredient picker.

### Domain (IO-free, `@breakery/domain/modifiers`)

- **`parseModifierIngredientsToDeduct(value: unknown): ModifierIngredient[]`** —
  validates the JSONB shape `{ product_id: string, qty: number > 0, unit: string }[]`;
  throws/returns errors on malformed input. Referenced by the column comment;
  create it now.
- Extend the modifier types to carry `ingredients_to_deduct` on the editable
  option shape (a BO-editor type; the POS row type stays as-is).
- Optionally a small `validateModifierDraft(groups)` pure helper that the panel
  uses for the validation rules below (keeps the component thin and unit-tested).

### Data flow

1. **Load** — `useProductModifiersAdmin` → flat rows → admin fold → `groups[]`
   draft state in `ModifiersPanel`.
2. **Edit** — all edits mutate the local draft; dirty flag flips.
3. **Save** — assemble the RPC payload:
   ```jsonc
   [
     {
       "group_name": "Milk",
       "group_type": "single_select",
       "group_required": true,
       "group_sort_order": 0,
       "options": [
         { "option_label": "Fresh milk", "price_adjustment": 0,     "is_default": true,  "option_sort_order": 0, "ingredients_to_deduct": [] },
         { "option_label": "Oat milk",   "price_adjustment": 10000, "is_default": false, "option_sort_order": 1, "ingredients_to_deduct": [{ "product_id": "<uuid>", "qty": 30, "unit": "ml" }] }
       ]
     }
   ]
   ```
   → `upsert_product_modifiers_v1(productId, payload)` → invalidate → reset dirty.

## Validation rules (client)

- `group_name` required, unique within the product.
- Each group has ≥ 1 option.
- `option_label` required, unique within its group.
- `single_select` + `group_required` ⇒ exactly one `is_default`.
- `single_select` (optional) ⇒ at most one `is_default`.
- `price_adjustment` is an integer IDR amount; default 0 (negative allowed only
  if the owner later asks — default rule: ≥ 0).
- Each `ingredients_to_deduct` row: a chosen raw material, `qty > 0`, a unit.

(The RPC itself is permissive — validation lives in the editor for good UX.)

## Permissions

- **Save** gated on `products.modifiers.update` (existing). The button is hidden
  or disabled when the auth store lacks it.
- **Read/edit draft** is available to anyone who can open the product detail page
  (already gated upstream).

## Testing

- **BO smoke tests** (Vitest + Testing Library, co-located `__tests__/`):
  - panel renders existing groups/options from a mocked load;
  - "Add group" / "Add option" mutate the draft;
  - Save calls `upsert_product_modifiers_v1` with the correctly-assembled JSONB;
  - Save is hidden/disabled without `products.modifiers.update`;
  - validation blocks save on a duplicate group name / missing default.
- **Domain unit tests**: `parseModifierIngredientsToDeduct` (valid + each
  malformed case) and `validateModifierDraft` if added.
- **Typecheck**: `pnpm --filter @breakery/app-backoffice typecheck` +
  `@breakery/domain` typecheck.
- **No pgTAP** (no DB change).

Mock-data note: any mock DATA objects feeding `useEffect` deps must use stable
refs (`vi.hoisted`) to avoid the infinite-render OOM pattern (S39 lesson).

## Risks & mitigations

- **Confusion with the S27c "Variants" tab** — mitigated by a distinct
  "Modifiers" tab label and leaving the Variants tab untouched.
- **Captured-but-inert ingredient data** — acceptable by design; Phase 2 wires
  consumption. The editor should make clear (helper text) that ingredient
  deduction is configured here and applied once Phase 2 ships, OR we keep the
  field plain; final copy decided in the plan.
- **Admin fold vs POS `mergeGroups` drift** — the admin fold preserves all
  fields; covered by a load smoke test asserting `ingredients_to_deduct`
  round-trips.

## Out of scope / Phase 2 (separate spec)

- Money-path stock deduction: `complete_order_with_payment_v13 → v14`,
  `pay_existing_order_v9 → v10`, `fire_counter_order_v3 → v4` read each chosen
  option's `ingredients_to_deduct` and deduct via `record_stock_movement_v1`
  (display-aware), plus void/refund reversals restore it; full pgTAP.
- Category-level modifier authoring.
- DnD reordering, option icons, live browser verification.
