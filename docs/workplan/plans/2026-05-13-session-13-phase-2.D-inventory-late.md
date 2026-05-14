# Session 13 — Phase 2.D — Inventory late (Opname + Movements + Alerts/Dashboard)

**Owner:** `inv-late`
**Wave:** 2
**Date opened:** 2026-05-14
**Complexity:** L (≈ 30-36h)
**Migration block:** `20260517000090..000097` (8 migrations).
**Branch:** `swarm/session-13`.

## Goal

Deliver the three Session 12 inventory phases never completed:
- Phase 5 — Opname (stock-count workflow with finalized adjustments → JE).
- Phase 6 — Stock-movements ledger view (paginated, filtered, drill-down).
- Phase 7 — Alerts + product dashboard (low-stock, reorder, expiring, sales velocity charts).

Plus the missing `view_section_stock_details` view consumed by reports / future
modules, and the missing Sections CRUD page.

## Acceptance / DoD

- [x] Sub-plan committed.
- [ ] Phantom audit: `grep -RE "stock_balances" apps/ packages/ supabase/` → 0 hits in code (docs OK).
- [ ] 8 migrations applied via MCP `apply_migration` (project `ikcyvlovptebroadgtvd`), verified via `list_migrations` (000090-097).
- [ ] After last migration : `generate_typescript_types` → write to `packages/supabase/src/types.generated.ts` + commit.
- [ ] `pnpm typecheck` green.
- [ ] Opname full cycle (create → add items → set count → validate → finalize → JE balanced via `tr_20_je_emit`) green via Vitest live.
- [ ] Cancel before finalize OK ; refused after finalize.
- [ ] Movements page filterable + cursor paginated + drill-down.
- [ ] AlertsPage 3 tabs (Low Stock / Reorder / Production*).  *Production placeholder until Phase 2.A.
- [ ] ProductDashboardPage renders sales-velocity bar + stock-by-section line + expiring lots table.
- [ ] AlertsBadge topbar with count of low_stock + reorder + expiring lots (uses the 3 RPCs).
- [ ] Sections CRUD page `/backoffice/inventory/sections` (list / edit / soft-delete).
- [ ] `view_section_stock_details` queryable + replaces all phantom `stock_balances` refs (grep audit).
- [ ] pgTAP suites for opname / movements / alerts pass.
- [ ] Vitest live suites for inventory-opname / inventory-movements / inventory-alerts green.
- [ ] BO smoke tests for new features added next to the code.
- [ ] Commits squash-mergeable, conventional, Claude co-author.

## Files

### Migrations (8)

| Block | File | Topic |
|---|---|---|
| 000090 | `20260517000090_init_inventory_counts.sql` | tables `inventory_counts` + `inventory_count_items` + count_number sequence + RLS |
| 000091 | `20260517000091_create_opname_rpcs.sql` | `create_opname_v1`, `add_opname_item_v1`, `set_opname_count_v1`, `validate_opname_v1`, `finalize_opname_v1`, `cancel_opname_v1` |
| 000092 | `20260517000092_create_get_stock_movements_rpc.sql` | `get_stock_movements_v1` (cursor paginated, filterable) |
| 000093 | `20260517000093_create_movements_aggregates_rpc.sql` | `get_movement_aggregates_v1` (sum by movement_type) |
| 000094 | `20260517000094_create_low_stock_rpc.sql` | `get_low_stock_v1` |
| 000095 | `20260517000095_create_reorder_suggestions_rpc.sql` | `get_reorder_suggestions_v1` (avg daily usage * lead-time) |
| 000096 | `20260517000096_create_product_dashboard_rpc.sql` | `get_product_dashboard_v1` |
| 000097 | `20260517000097_create_view_section_stock_details.sql` | view (security_invoker) |

### App (BO)

**Features (CREATE):**
- `apps/backoffice/src/features/inventory-opname/` — list, detail, count workflow components + hooks.
- `apps/backoffice/src/features/inventory-movements/` — table, filters, drill-down + hooks.
- `apps/backoffice/src/features/inventory-alerts/` — AlertsBadge, LowStockTab, ReorderTab, ProductionAlertsTab + hooks.
- `apps/backoffice/src/features/inventory-dashboard/` — ProductDashboardCharts (Recharts) + hooks.
- `apps/backoffice/src/features/sections/` — Sections list / edit / delete + hooks.

**Pages (CREATE):**
- `OpnameListPage`, `OpnameDetailPage`.
- `StockMovementsPage`.
- `AlertsPage` (3 tabs).
- `ProductDashboardPage` (route `/backoffice/products/:productId/dashboard`).
- `SectionsPage`.

**Layouts / Routes (UPDATE):**
- `apps/backoffice/src/layouts/BackofficeLayout.tsx` — sidebar items + topbar AlertsBadge.
- `apps/backoffice/src/routes/index.tsx` — new routes.

### Tests

- `supabase/tests/inventory_opname.test.sql` — T_OPN_01..13 (pgTAP).
- `supabase/tests/inventory_movements.test.sql` — T_MOV_01..07 (pgTAP).
- `supabase/tests/inventory_alerts.test.sql` — T_ALERT_01..07 (pgTAP).
- `supabase/tests/functions/inventory-opname.test.ts` — Vitest live full cycle.
- `supabase/tests/functions/inventory-movements.test.ts` — Vitest live.
- `supabase/tests/functions/inventory-alerts.test.ts` — Vitest live.
- BO smoke tests under each feature's `__tests__/`.

## Implementation order

1. Sub-plan + phantom-audit (this commit).
2. Migration 000090 + 000091 + opname pgTAP first ; apply via MCP ; run pgTAP envelope.
3. Migration 000092 + 000093 + movements pgTAP.
4. Migration 000094 + 000095 + alerts pgTAP.
5. Migration 000096 + 000097.
6. Regen types from staging → commit.
7. Vitest live suites.
8. BO features (hooks → components → pages → smoke) ; one feature per commit.
9. Final : typecheck full repo + commit summary.

## Key design notes

### Opname JE wiring

Spec mentioned `opname_adjust_up` / `opname_adjust_down` but `tr_20_je_emit`
(migration 000022) handles `opname_in` / `opname_out`. We use the **existing
enum values** to keep the JE path live. Variance positive → `opname_in`
(`INVENTORY_GENERAL DR / OPNAME_INCOME CR`) ; negative → `opname_out`
(`OPNAME_EXPENSE DR / INVENTORY_GENERAL CR`).

This deviation is documented in `2026-05-14-session-13-wave-2-deviations.md`
as **D-W2-2D-01**.

### Permission gates

`inventory.opname.create` (MANAGER+) and `inventory.opname.finalize` (ADMIN+)
were already seeded in migration 000018 + 000030 (role_permissions table).
We INSERT additional rows only if we add brand-new perms ; we never re-CREATE
`has_permission()` (CI grep gate from W1-C4).

### Stock-movements cursor pagination

`get_stock_movements_v1` returns rows ordered by `created_at DESC, id DESC`
and accepts `p_cursor TIMESTAMPTZ` + `p_cursor_id UUID` (tie-breaker for same
timestamp). The frontend stores the last row's `(created_at, id)` and passes
back on the next call. Limit hard-capped at 200.

### Reorder suggestions

`get_reorder_suggestions_v1(p_lookback_days INT DEFAULT 30)` computes :
- `avg_daily_usage` = SUM of |quantity| from `stock_movements` for
  `movement_type IN ('sale','production_out','waste','transfer_out')`
  over last N days / N.
- `days_of_stock` = `current_stock / NULLIF(avg_daily_usage, 0)`.
- `suggested_order_qty` = `max(0, avg_daily_usage * 14 - current_stock)`
  (14-day buffer ; configurable via param).
- Filters to products where `days_of_stock < 7` OR `current_stock < min_stock_threshold`.

### `view_section_stock_details`

Pure read view with `security_invoker = on` (so RLS on `section_stock` /
`products` / `sections` is respected). No DML. Includes `stock_value` for
reports.

## Risks / blockers

- Re-CREATE of `has_permission()` would trigger the CI grep gate. We don't
  modify the function ; only INSERT into `role_permissions`.
- pgTAP `BEGIN ... ROLLBACK` envelope via `execute_sql` requires the suite
  to be self-contained (no shared fixtures from `inventory_phase1_complete`).
  Each new suite seeds its own products/sections.
- The Vitest live suites depend on `auth-verify-pin` EF being deployed on
  cloud. Assume it is — Wave 1 inventory tests already use it.

## Out of scope (kept for future phases)

- Production alerts tab in AlertsPage is a **placeholder** ; the actual
  feed lands in Phase 2.A (prod-recipes) which is parallel to 2.D.
- `get_reorder_suggestions_v1` does not consume `purchase_orders` lead times
  (Phase 3.A). Default 14 days.

## Deviation log

See `docs/workplan/refs/2026-05-14-session-13-wave-2-deviations.md`
(append D-W2-2D-* entries as the phase lands).
