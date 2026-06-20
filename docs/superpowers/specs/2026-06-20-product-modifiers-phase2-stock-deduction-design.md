# Product Modifiers — Phase 2: order-time ingredient stock deduction — Design Spec

- **Date**: 2026-06-20
- **Branch**: `swarm/session-49`
- **Status**: Approved design — ready for implementation plan
- **Scope**: Phase 2 of 2. Phase 1 (Backoffice editor, merged via PR #99) authored
  `product_modifiers.ingredients_to_deduct` but left it inert. This phase wires
  real stock deduction into the money-path RPCs + reversals.
- **Predecessor**: [`2026-06-19-product-modifiers-editor-design.md`](2026-06-19-product-modifiers-editor-design.md)

## Problem

A modifier option may carry `ingredients_to_deduct` (JSONB) — an array of
`{ product_id UUID, qty NUMERIC, unit TEXT }` raw-material lines authored in the
Backoffice (Phase 1). Example: choosing **Oat milk** should consume 30 ml of the
"Oat Milk" raw material per drink. Today this data is **written but never read**:
the money-path RPCs apply the option's `price_adjustment` but never deduct the
ingredient stock, and the reversals never restore it.

## Critical finding — the chosen modifiers do NOT carry the ingredients

When an order line is persisted, `order_items.modifiers` carries only
`{ group_name, option_label, price_adjustment }` (domain `ModifierOption`,
`packages/domain/src/modifiers/types.ts:22-28`; payload built at
`packages/domain/src/orders/buildOrderPayload.ts:16`). The ingredients are **not**
in the order payload.

Therefore the server is the **single source of truth**: each money-path RPC must
**resolve** `ingredients_to_deduct` from `product_modifiers` by
`(product_id, group_name, option_label)` at order time. Client-sent data is never
trusted for quantities — the same posture as the `unit_price` reconciliation
hardened in S37/S44.

This mirrors exactly how S47 combos deduct per **component**: the chosen set is
resolved/snapshotted server-side and restored from the snapshot on reversal.

## Goals

1. Direct POS sale deducts each chosen option's ingredients (converted to base
   unit, scaled by line quantity), display-aware.
2. Counter fire → pay and pickup pay-existing deduct the same, exactly once.
3. Void and refund restore the deducted ingredient stock (refund scaled by the
   refunded quantity).
4. Reversal fidelity even if a modifier is edited after the order — via an
   order-time snapshot, not a re-lookup.
5. Full pgTAP coverage (money path).

## Non-goals (Phase 2)

- **B2B tablet path** — `create_tablet_order_v2`, `create_b2b_order_v1`, and the
  tablet pickup/complete path are out of scope (mirrors S47 deferring "combos
  tablette B2B"). Modifiers on tablet B2B orders keep applying price only.
- Category-level modifier ingredient authoring (the editor is product-scoped).
- FIFO lot-aware ingredient consumption (ingredients deduct from `current_stock`
  via the same direct `stock_movements` insert the combo path uses).
- Ingredient-deduction analytics / reporting.
- Backoffice or POS UI changes (this is DB + EF only).

## Architecture

DB + Edge Function only. One additive schema change. RPC version bumps follow the
project's monotonic versioning (`DROP FUNCTION old(...)` + recreate + canonical
anon REVOKE pair in the same migration block).

### Single source of truth & snapshot

The resolved-and-converted ingredient set is **frozen into a new
`order_items.modifier_ingredients_deducted` JSONB column** at order time, the
exact mirror of S47 `combo_components`. Deduction reads the resolved set;
reversals read the persisted snapshot. A modifier edited later cannot corrupt an
existing order.

### Schema (1 additive migration, no destructive change)

```sql
ALTER TABLE order_items
  ADD COLUMN modifier_ingredients_deducted JSONB;
```

Shape per element:
```jsonc
{ "product_id": "<uuid>", "qty_base": 0.03, "unit": "L",
  "group_name": "Milk", "option_label": "Oat milk" }
```

`NULL` when a line has no ingredient-bearing modifiers. Additive → existing rows
and existing consumers are unaffected. Types regen + commit.

### Money-path RPC bumps (atomic set)

The deduction set ships together — deduction without reversals would leak stock.

| RPC | Bump | Responsibility |
|---|---|---|
| `complete_order_with_payment_v13` | → **v14** | direct sale: resolve + convert + deduct (display-aware) + persist snapshot |
| `pay_existing_order_v9` | → **v10** | pickup/pay: deduct from the persisted snapshot |
| `fire_counter_order_v3` | → **v4** | persist the resolved snapshot at fire (so pay deducts exactly the fired set — DEV-S47-Aprime lesson) |
| `void_order_rpc_v2` | → **v3** | restore from snapshot (`sale_void`, display-aware) |
| `refund_order_rpc_v3` | → **v4** | restore from snapshot, scaled by refunded qty |
| `cancel_order_item_rpc_v2` | unchanged | pre-payment, no stock effect |

EF `process-payment` redeploys (`verify_jwt=false`) to call `v14` — mandatory
since `v13` is dropped.

### Resolution & conversion (the deduction unit of work)

A reusable resolution pattern, applied identically in `complete_order_v14`,
`fire_counter_order_v4` (snapshot only), and read back by `pay_existing_v10`:

1. **Resolve** — for each order line with a non-empty `modifiers[]`, join
   `product_modifiers` on `(product_id = line.product_id, group_name,
   option_label, is_active = true, deleted_at IS NULL)` and read
   `ingredients_to_deduct`. An option that no longer resolves (edited away)
   yields no ingredients — no deduction, no error (price was already validated).
2. **Convert** — per ingredient line:
   `qty_base = qty × COALESCE(factor_to_base, 1)`, where `factor_to_base` comes
   from `product_unit_alternatives` for `(ingredient product_id, unit)`; the
   ingredient's own base unit ⇒ factor 1. Mirrors `receive_purchase_order_v2`
   (S46). Then scale by the order line `quantity`.
3. **Deduct** — `INSERT INTO stock_movements(product_id = ingredient,
   movement_type = 'sale', quantity = -qty_base, unit = base_unit, reason …)`
   + `UPDATE products.current_stock`. Display-aware branch mirrors the combo
   component loop (`display_movements` + `display_stock` when `is_display_item`).
   `record_stock_movement_v1` forbids `sale`/`sale_void`, so — exactly like the
   combo path — these rows are inserted directly inside the order RPC, not via
   the primitive.
4. **Snapshot** — persist the resolved+converted lines (incl. `qty_base`) into
   `order_items.modifier_ingredients_deducted`.

### Reversal

`void_order_rpc_v3` / `refund_order_rpc_v4` read
`order_items.modifier_ingredients_deducted` and post
`movement_type = 'sale_void'` for each line (`+qty_base`) + `UPDATE
products.current_stock`, display-aware (`display_movements` type `adjustment`).
Refund scales by the refunded fraction of the line, consistent with how the
combo and main-line restores already scale.

## Data flow

```
POS line (modifiers[] = {group_name, option_label, price_adjustment})
  └─ complete_order_v14 / fire_counter_v4
       ├─ resolve product_modifiers.ingredients_to_deduct by (pid, group, option)
       ├─ convert qty × factor_to_base × line.quantity  → qty_base
       ├─ deduct stock_movements('sale', -qty_base) + current_stock (display-aware)   [complete only; fire snapshots only]
       └─ snapshot → order_items.modifier_ingredients_deducted
  pay_existing_v10 (pickup / fired-then-paid)
       └─ deduct from order_items.modifier_ingredients_deducted (display-aware)
  void_v3 / refund_v4
       └─ restore stock_movements('sale_void', +qty_base) from the snapshot
```

## Error handling & invariants

- **Insufficient ingredient stock** — the validation phase of
  `complete_order_v14` / `pay_existing_v10` checks each resolved ingredient's
  available stock and raises the existing insufficient-stock error **before any
  write**. The whole RPC is one transaction → atomic; a failed ingredient never
  half-commits.
- **Idempotency** — deduction rides inside each RPC's existing replay envelope.
  On `pay_existing` / reversals the presence of the persisted snapshot makes
  re-resolution unnecessary and replay non-doubling.
- **Server-authoritative** — quantities are read from `product_modifiers`, never
  from the client payload.
- **Fire vs pay symmetry** — `fire_counter_v4` persists the snapshot but does
  **not** deduct (consistent with today: fire never touches stock; `pay_existing`
  does). `pay_existing_v10` deducts strictly from the persisted snapshot so a
  fired-then-paid order deducts exactly what was fired, once.

## Testing

New `supabase/tests/modifier_ingredient_deduction.test.sql` (BEGIN/ROLLBACK,
cloud MCP, jwt-claim simulation):

1. direct sale deducts converted base-unit qty (ml→L) scaled by line quantity;
2. multi-ingredient option + a line carrying multiple modifier groups;
3. fire → pay deducts exactly the fired snapshot — no double-deduct, no miss;
4. void restores ingredient stock;
5. refund restores scaled by the refunded quantity;
6. insufficient ingredient stock blocks the sale (no partial write);
7. display-aware ingredient (defensive) writes `display_movements`;
8. replay idempotency = no double deduction;
9. an option edited away after order resolves to no deduction (no error).

Plus: non-regression bumps of the S44/S47 suites referencing v13/v9/v2/v3 → v14/
v10/v4/v3 (named args, signatures stable except the new behavior); full
`pnpm typecheck` 6/6; types regen committed.

## Risks & mitigations

- **Money-path regression** — mitigated by the snapshot pattern (proven by S47
  combos), full pgTAP, and reuse of the exact combo deduction/reversal loops.
- **Unit-conversion correctness** — mitigated by mirroring `receive_purchase_
  order_v2` (S46) and a dedicated ml→L pgTAP assertion.
- **Fire→pay double-deduct** — mitigated by the fire-snapshot + pay-from-snapshot
  split (the DEV-S47-Aprime lesson, re-applied).
- **EF/RPC version skew** — `v13` is dropped, so `process-payment` MUST redeploy
  to `v14` in the same change (hard cutover, `verify_jwt=false`).

## Out of scope / Phase 3+

- B2B tablet path (`create_tablet_order_v2`, `create_b2b_order_v1`, tablet
  pickup/complete).
- Category-level modifier ingredient authoring.
- FIFO lot-aware ingredient consumption.
- Ingredient-deduction analytics / reporting / a "modifier consumption" report.
