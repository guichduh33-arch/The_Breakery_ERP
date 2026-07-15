# Session 47 — Configurable Combos — INDEX

**Branch:** `swarm/session-47-combos` (base `master` post-S46).
**Spec:** [`2026-06-19-session-47-configurable-combos-spec.md`](../../specs/archive/2026-06-19-session-47-configurable-combos-spec.md)
**Plan:** [`2026-06-19-session-47-configurable-combos-plan.md`](./2026-06-19-session-47-configurable-combos-plan.md)

Replaces the fixed-bundle combo model with configurable **choice groups** (single/multi,
required/optional, per-option surcharge + default). Back-office builder + POS configuration
flow that sells a combo as **one order line at combo base price** while deducting each
**chosen component's** stock. A combo stays a `products` row (`product_type='combo'`); two
new tables (`combo_groups`, `combo_group_options`) hold its choice structure; surcharges ride
in the existing `order_items.modifiers` JSONB; components ride in a new
`order_items.combo_components` JSONB snapshot.

## Waves

| Wave | Scope | Status |
|------|-------|--------|
| A — DB | schema + guards, `upsert_combo_v1`, `delete_combo_v1`, migrate legacy + drop `combo_items`, sale RPC v13, reversals | ✅ |
| A′ — DB (fire-path extension, added this session) | `fire_counter_order_v3` + `pay_existing_order_v9` combo-aware | ✅ |
| B — domain | combo types + `pricing` + `validateSelection` (IO-free) | ✅ |
| C — backoffice | `useCombos`/`useComboDetail`/`useUpsertCombo`/`useDeleteCombo` + ComboBuilderPage + routes + CombosPage rewire | ✅ |
| D — POS | `useComboConfig`, `ComboConfigModal`, tap→modal→cart line, forward `combo_components` + v13/v9/v3 | ✅ |
| E — closeout | typecheck 6/6, INDEX, CLAUDE.md bump | ✅ |

## Migrations (NAME-block `20260704000010..022`, cloud versions clock-assigned)

| NAME | Purpose |
|------|---------|
| `_010_combo_schema` | `products` combo cols + `combo_groups` + `combo_group_options` + guards (parent-is-combo, anti-nesting) + RLS |
| `_011_create_upsert_combo_v1` | `upsert_combo_v1(jsonb, uuid)` REPLACE semantics, idempotency, gates `combos.create`/`combos.update` |
| `_012_revoke_anon_upsert_combo_v1` | REVOKE pair |
| `_013_create_delete_combo_v1` | `delete_combo_v1(uuid)` soft-delete, gate `combos.delete` |
| `_014_revoke_anon_delete_combo_v1` | REVOKE pair |
| `_015_migrate_combos_to_groups` | backfill legacy combos → groups, drop `combo_items` |
| `_016_bump_complete_order_v13` | `+order_items.combo_components`; v12→v13 combo-aware stock (deduct components, not the virtual combo) |
| `_017_revoke_anon_complete_order_v13` | REVOKE pair |
| `_018_combo_aware_reversals` | void/refund restore component stock for combo lines |
| `_019_bump_fire_counter_order_v3` | **(A′)** v2→v3: persist `combo_components` snapshot into `order_items` for combo lines |
| `_020_revoke_anon_fire_counter_order_v3` | **(A′)** REVOKE pair |
| `_021_bump_pay_existing_order_v9` | **(A′)** v8→v9: deduct each persisted `combo_components[]` product (display-aware), not the virtual combo |
| `_022_revoke_anon_pay_existing_order_v9` | **(A′)** REVOKE pair |

> Note: cloud `version`s are clock-assigned (project convention S36+). For the A′ pair, the
> controller folded each REVOKE into the function's `apply_migration` call (2 cloud entries:
> `bump_fire_counter_order_v3`, `bump_pay_existing_order_v9`); the `_020`/`_022` local files
> remain the canonical REVOKE record (idempotent on replay). DEV-S47-Aprime-02.

## Permissions

**Deviation DEV-S47-A2-01:** the plan proposed a new `products.combos.write`. Implementation
instead **reuses the pre-existing S11 `combos.create` / `combos.update` / `combos.delete`**
permissions (MANAGER+/ADMIN+). No new permission seeded; `PermissionCode` union unchanged.

## Tests

- pgTAP cloud: `combo_crud` (schema guards + upsert/delete), `combo_migration`, `combo_sale`
  (v13 component-stock), `combo_reversal` (void/refund restore), **`combo_fire_pay` 8/8 NEW**
  (fire persists snapshot + no stock move; pay deducts each component, combo untouched; anon
  revoked; v8/v2 dropped).
- Vitest domain: combo `pricing` + `validateSelection` (40/40 cart incl. `addComboItem` merge).
- Vitest POS: `combo` glob 21/21 (ComboConfigModal, useComboConfig, combo cart display,
  product-tap-combo); fire/pay-existing/checkout 20/20 after v3/v9/v13 bumps.
- `pnpm typecheck` **6/6**.

## Deviations

| ID | Severity | Note |
|----|----------|------|
| DEV-S47-A2-01 | medium | Reused S11 `combos.{create,update,delete}` instead of new `products.combos.write`. RPC gates + PermissionCode union reflect this. |
| DEV-S47-D2-01 | info | `ComboConfigModal.onConfirm` emits resolved `{components, modifiers, unitPrice}` (not raw `ComboSelection[]` as the plan signature listed) — D3 only needs the payload. |
| DEV-S47-D3-01 | info | `ComboCartItemRow` derives displayed components from the line's own `modifiers` snapshot (cashier's choices), not `useComboConfig` defaults. |
| DEV-S47-D3-02 | medium | POS test infra: added `afterEach(cleanup)` to `apps/pos/vitest.setup.ts` (suite runs without file isolation → RTL auto-cleanup self-registers only in the first file → later files accumulated Radix Dialog portals → "multiple elements"). `ComboConfigModal.smoke` switched from per-test `await import` to a static top-level import (29s→10s test time, no timeout). |
| DEV-S47-Aprime-01 | medium | **Scope extension (user-approved):** the fire-then-pay (dine-in/counter) path was not combo-aware — only direct checkout (v13) was. `fire_counter_order_v3` + `pay_existing_order_v9` added. Without it, firing then paying a combo raised P0002 (v8 checked the virtual combo's current_stock=0) — a hard failure, not just a stock leak. |
| DEV-S47-Aprime-02 | info | Cloud folded each A′ REVOKE pair into its function `apply_migration` (2 cloud entries); local `_020`/`_022` files are the canonical record, idempotent on replay. |
| DEV-S47-Aprime-03 | info | `process-payment` EF redeploy to v13 was mandatory regardless of the fire-path extension — A5 dropped v12, so the deployed EF (calling v12) was already broken on cloud. Deployed version 11, `verify_jwt=false`. |

## Out of scope (defer S48+)

Quantity-per-option > 1 in the configurator UI, nested combos, combo station routing of
components to multiple prep printers (combo line routes by the combo product's
`dispatch_station`), combos in catalog import/export, combo analytics, tablet (B2B) combo
ordering, browser-live verification (not executed).
