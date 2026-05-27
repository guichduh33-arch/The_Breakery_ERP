# Session 32 — Reports Vague C close-out drill-down + /backoffice/orders list — INDEX

> **Date** : 2026-05-26 → 2026-05-27 (closeout)
> **Branche** : `swarm/session-32`
> **Base** : `master` @ `c74e295` (post-merge S31 PR #39)
> **Status** : ✓ ready to merge
> **Spec** : [`../specs/2026-05-26-session-32-spec.md`](../specs/2026-05-26-session-32-spec.md)
> **Plan** : [`./2026-05-26-session-32-plan.md`](./2026-05-26-session-32-plan.md)

---

## 1. Summary

Ferme les 7 reports "terminal documentés" laissés par S31 — 4 accounting (P&L, BS, CF*, PB1) + StockMovementHistory product drill + PaymentByMethod + SalesByHour — en livrant :
- 2 bumps DB additifs (`get_profit_loss_v1`, `get_balance_sheet_v1`) exposant `account_id` UUID en plus du `code` 3-4 digit (CF déféré S33+ — voir §10 DEV-S32-1.D-01).
- 1 nouvelle RPC `get_orders_list_v1` cursor-paginée avec filtres JSONB unique (10 axes : status / order_type / customer_id / served_by / payment_method / customer_type / total_min/max / refund_status* / hour*).
- 1 nouvelle page `/backoffice/orders` (audit-grade list page, URL state = source of truth, infinite scroll, 9 colonnes, filtres en barre + chips actifs).
- 1 nouvelle GeneralLedgerPage `?account_id=&start=&end=` URL-driven (Wave 3.A).
- 1 nouveau hook réutilisable `useAccountIdByCode` pour résoudre code COA → UUID client-side (S32 Wave 3.G).
- `buildDrilldownUrl` étendu avec entity `'order_list'` filter-only.
- 7 drill-down wirings transverses sur les reports.

\* CF account drill déferé S33+ (méthode indirecte du Cash Flow n'a pas de lignes per-account natives, requiert refonte de la RPC). \* `refund_status` et `hour` sont des filtres post-fetch client-side dans OrdersListPage V1 — server-side filter requiert nouvelle RPC arg, S33+.

**Tests** : ~40 (18 unit `buildDrilldownUrl` extended order_list + 2 unit `useOrdersList` + 3 smoke `GeneralLedgerPage` + 3 smoke `OrdersListPage` + 1 smoke each P&L/BS/PB1/Stock/PaymentByMethod/SalesByHour drill = 6 + non-régression S31 ~11). `pnpm typecheck` 6/6 PASS. pgTAP : 2/2 `accounting_account_id_exposed` + 9/9 `orders_list_v1` via cloud MCP.

---

## 2. Migrations applied (4)

Block `20260617000010..014` :

| # | Name | Object | Notes |
|---|---|---|---|
| `_010` | `bump_get_profit_loss_v1_expose_account_id` | RPC `get_profit_loss_v1` | Additive — JSONB lines[] gains `account_id` |
| `_011` | `bump_get_balance_sheet_v1_expose_account_id` | RPC `get_balance_sheet_v1` | Additive — adds `lines[]` array with per-account drill data |
| `_013` | `create_get_orders_list_v1_rpc` | new RPC `get_orders_list_v1` SECURITY DEFINER | Cursor-paginated, JSONB filters, gate `orders.read` |
| `_014` | `revoke_anon_get_orders_list_v1` | REVOKE pair | S25 canonical (REVOKE FROM anon + ALTER DEFAULT PRIVILEGES REVOKE FROM PUBLIC) |

\_012 was reserved for CF bump — deferred S33+ (DEV-S32-1.D-01, indirect method has no per-account lines, requires RPC refactor not just a column addition).

Applied via cloud MCP `apply_migration` sur `ikcyvlovptebroadgtvd`. Types regen'd post-`_011` (Wave 1.G commit).

---

## 3. New files (S32)

### DB + tests
- `supabase/migrations/20260617000010_bump_get_profit_loss_v1_expose_account_id.sql`
- `supabase/migrations/20260617000011_bump_get_balance_sheet_v1_expose_account_id.sql`
- `supabase/migrations/20260617000013_create_get_orders_list_v1_rpc.sql`
- `supabase/migrations/20260617000014_revoke_anon_get_orders_list_v1.sql`
- `supabase/tests/accounting_account_id_exposed.test.sql` — 2 pgTAP
- `supabase/tests/orders_list_v1.test.sql` — 9 pgTAP

### BO hook layer (Wave 2)
- `apps/backoffice/src/features/orders/hooks/useOrdersList.ts` (Wave 2.F)
- `apps/backoffice/src/features/orders/hooks/__tests__/useOrdersList.test.tsx` — 2 unit
- `apps/backoffice/src/features/accounting/hooks/useAccountIdByCode.ts` (Wave 3.G — code→UUID resolver, 24h cache)

### BO pages (Wave 3)
- `apps/backoffice/src/pages/orders/OrdersListPage.tsx` (Wave 3.B + 3.K combined — skeleton + filters bar in one pass)
- `apps/backoffice/src/pages/orders/__tests__/OrdersListPage.smoke.test.tsx` — 3 smoke
- `apps/backoffice/src/pages/reports/__tests__/profit-loss-drilldown.smoke.test.tsx` — 1 smoke
- `apps/backoffice/src/pages/reports/__tests__/balance-sheet-drilldown.smoke.test.tsx` — 1 smoke
- `apps/backoffice/src/pages/reports/__tests__/pb1-drilldown.smoke.test.tsx` — 1 smoke
- `apps/backoffice/src/pages/reports/__tests__/stock-movement-history-drilldown.smoke.test.tsx` — 1 smoke
- `apps/backoffice/src/pages/reports/__tests__/payment-by-method-drilldown.smoke.test.tsx` — 1 smoke
- `apps/backoffice/src/pages/reports/__tests__/sales-by-hour-drilldown.smoke.test.tsx` — 1 smoke

### Workplan
- `docs/workplan/specs/2026-05-26-session-32-spec.md`
- `docs/workplan/plans/2026-05-26-session-32-plan.md`
- `docs/workplan/plans/2026-05-26-session-32-INDEX.md` (this file)

---

## 4. Files modified (S32)

### Routes + types
- `apps/backoffice/src/routes/index.tsx` — added `<Route path="orders">` with `<PermissionGate required="orders.read">`
- `apps/backoffice/src/layouts/Sidebar.tsx` — new "Orders" entry in Management group (ShoppingBag icon, gated `orders.read`)
- `packages/supabase/src/types.generated.ts` — regen post Wave 1 migrations

### BO hooks bumped
- `apps/backoffice/src/features/reports/utils/buildDrilldownUrl.ts` — `'order_list'` filter-only entity (Wave 2.A)
- `apps/backoffice/src/features/reports/hooks/useProfitLoss.ts` — `PnlLine.account_id` exposed (Wave 2.B)
- `apps/backoffice/src/features/reports/hooks/useBalanceSheet.ts` — `BalanceSheet.lines[]` + `BalanceSheetLine.account_id` exposed (Wave 2.C)
- `apps/backoffice/src/features/reports/hooks/useStockMovementsReport.ts` — `product_id` surfaced (Wave 2.E, fixes S31 DEV-S31-3.B-01)

### BO pages wired
- `apps/backoffice/src/pages/reports/ProfitLossPage.tsx` — Wave 3.D account drill
- `apps/backoffice/src/pages/reports/BalanceSheetPage.tsx` — Wave 3.E — added "Per-account detail" table below 3-column A=L+E layout (aggregated buckets stay non-drillable, they're 1:N to accounts)
- `apps/backoffice/src/pages/reports/Pb1ReportPage.tsx` — Wave 3.G — PB1 payable KPI card drills to GL filtered by account 2110 (UUID resolved client-side via `useAccountIdByCode`)
- `apps/backoffice/src/pages/reports/StockMovementHistoryPage.tsx` — Wave 3.H product drill
- `apps/backoffice/src/pages/reports/PaymentByMethodPage.tsx` — Wave 3.I → `/backoffice/orders?payment_method=…&start&end`
- `apps/backoffice/src/pages/reports/SalesByHourPage.tsx` — Wave 3.J — added "Per-hour detail" table below the chart (only hours with `order_count > 0`)
- `apps/backoffice/src/pages/accounting/GeneralLedgerPage.tsx` — Wave 3.A URL params

### `buildDrilldownUrl` tests
- `apps/backoffice/src/features/reports/utils/__tests__/buildDrilldownUrl.test.ts` — extended from 13 to 18 unit (5 new for `order_list` filter-only)

---

## 5. Tests run

| Suite | Count | Status |
|---|---|---|
| pgTAP `accounting_account_id_exposed` (cloud MCP) | 2/2 | PASS |
| pgTAP `orders_list_v1` (cloud MCP) | 9/9 | PASS |
| Unit `buildDrilldownUrl` (18, +5 over S31) | 18/18 | PASS |
| Unit `useOrdersList` | 2/2 | PASS |
| Smoke `GeneralLedgerPage` URL params | 3/3 | PASS |
| Smoke `OrdersListPage` | 3/3 | PASS |
| Smoke `profit-loss-drilldown` | 1/1 | PASS |
| Smoke `balance-sheet-drilldown` | 1/1 | PASS |
| Smoke `pb1-drilldown` | 1/1 | PASS |
| Smoke `stock-movement-history-drilldown` | 1/1 | PASS |
| Smoke `payment-by-method-drilldown` | 1/1 | PASS |
| Smoke `sales-by-hour-drilldown` | 1/1 | PASS |
| S31 non-regression smoke sweep (5 reports) | 5/5 | PASS |
| `pnpm typecheck` (6 packages) | 6/6 | PASS |

Aggregate smoke + unit S32-touching sweep : **16 files / 40 tests PASS, 0 fail**.

---

## 6. Permissions seeded (0)

No new permissions. `orders.read` was already seeded by S31 (`20260616000010`) and is reused by both the new `get_orders_list_v1` RPC gate and the `/backoffice/orders` route gate.

---

## 7. RPCs added / bumped (3)

| Action | RPC | Notes |
|---|---|---|
| Bumped (CREATE OR REPLACE, additive) | `get_profit_loss_v1` | `lines[].account_id` added — signature unchanged |
| Bumped (CREATE OR REPLACE, additive) | `get_balance_sheet_v1` | Top-level `lines[]` array added with per-account detail — signature unchanged |
| Created | `get_orders_list_v1(p_start DATE, p_end DATE, p_filters JSONB, p_limit INT, p_cursor TEXT)` | SECURITY DEFINER, gate `orders.read`, REVOKE pair S25 canonical, cursor-paginated |

---

## 8. Tasks closed

| Task | Status | Source |
|---|---|---|
| S31 DEV-S31-3.B-01 (StockMovements product drill) | DONE | RPC already surfaced `product_id`, hook + page wired |
| S31 DEV-S31-3.D (4 accounting drill terminal) | PARTIAL — P&L + BS + PB1 done, CF deferred S33+ | Spec §1 |
| S31 PaymentByMethod terminal comment | DONE | Wired to `/backoffice/orders?payment_method=…` |
| S31 SalesByHour terminal comment | DONE | Wired to `/backoffice/orders?hour=…` |
| Spec §1 transverse Vague C item — `/backoffice/orders` list page | DONE | OrdersListPage + RPC + sidebar entry |
| Spec §1 transverse Vague C item — GL URL params | DONE | Wave 3.A |

---

## 9. RPCs / EFs out of scope (deferred S33+)

| RPC | What | Why deferred |
|---|---|---|
| `get_cash_flow_v1` | Add `account_id UUID` to lines | Indirect method computes flows from category-rolled balances (CFO from net income + non-cash adj, CFI from fixed-asset deltas, CFF from debt/equity deltas) — there is no per-account line shape to surface. A direct-method variant would need a separate RPC, S33+. (DEV-S32-1.D-01) |
| `get_orders_list_v1` v2 | Server-side `refund_status` filter | V1 fetches all and post-filters client-side because `refund_status` is derived from `refunds` aggregation, not a column. V2 should compute server-side via subquery. (DEV-S32-1.E-01) |
| `get_orders_list_v1` v2 | Server-side `hour` filter | Same — V1 post-filters via `new Date(o.created_at).getHours()`. V2 should add `p_hour INT` arg and `EXTRACT(HOUR FROM created_at AT TIME ZONE …) = p_hour`. (DEV-S32-1.E-02) |
| `get_orders_list_v1` v2 | `terminal_id` filter axis | Dropped V1 — `orders` table has no `terminal_id` column (DEV-S32-1.A-01). Would require schema migration first. |

---

## 10. Deviations vs spec/plan

| ID | Section spec | Original plan | What happened | Reason | Risk |
|---|---|---|---|---|---|
| DEV-S32-1.A-01 | §3.4 RPC signature | `terminal_id` filter axis | Dropped — schema discovery showed `orders` has no `terminal_id` column | Schema reality | Informational |
| DEV-S32-1.A-02 | §3.4 customer name | `customers.full_name` | Used `customers.name` (only `name` exists) | Schema reality | Informational |
| DEV-S32-1.A-03 | §3.4 refunds | `refunds.amount` | Used `refunds.total` (only `total` exists) | Schema reality | Informational |
| DEV-S32-1.C-01 | §3.2 BS bump | Add `account_id` to existing `lines[]` | Created `lines[]` array from scratch (it didn't exist on BS) + each line has `account_id` | Hook + RPC discovery — BS shape was category-rolled only | Informational |
| DEV-S32-1.D-01 | §3.3 CF bump | Add `account_id` to CF lines | Skipped CF bump entirely; deferred S33+ | Indirect method has no per-account lines — refactor required | Documented in §9 |
| DEV-S32-3.B-01 | Plan §3.B + 3.K | Two separate commits | Single combined commit | OrdersListPage authored in one pass with full filters | Informational |
| DEV-S32-3.E-01 | Plan §3.E | "Wrap account line code cells" | Added new "Per-account detail" table — BS had no per-account cells visually, only category aggregates | Page architecture | Informational |
| DEV-S32-3.G-01 | Plan §3.G | "Resolve account 2110" | Created reusable `useAccountIdByCode(code)` hook in `features/accounting/hooks/` rather than inlining | Reusability — future cards may need same | Informational |
| DEV-S32-3.J-01 | Plan §3.J | "Wrap each hour row" | Added new "Per-hour detail" table below the chart — SalesByHour had no hour rows visually, only a recharts BarChart | Page architecture | Informational |
| DEV-S32-CLEANUP-01 | — | — | Two stray empty files (`v_clamp`, `{,+`) and a deleted `.env.example` found at session start — cleanup in Wave 4 startup | Accidental shell artifacts from prior interrupted session | Informational |

---

## 11. Acceptance criteria

- [x] Wave 1 — DB layer : 4 migrations applied cloud V3 dev (CF deferred per DEV-S32-1.D-01) + pgTAP 11/11 PASS (2 + 9)
- [x] Wave 1 — types regen committed post Wave 1
- [x] Wave 2 — `buildDrilldownUrl` extended `'order_list'` (5 new unit, 18/18 PASS) + 4 hooks bumped (`useProfitLoss`, `useBalanceSheet`, `useStockMovementsReport`, `useOrdersList`) + 2/2 `useOrdersList` unit PASS
- [x] Wave 3.A — GeneralLedgerPage reads `?account_id=&start=&end=` URL params (3/3 smoke PASS)
- [x] Wave 3.B + 3.K — OrdersListPage created (filters bar + URL state + infinite scroll + chips + sidebar entry + route gate)
- [x] Wave 3.C — OrdersListPage smoke 3/3 PASS
- [x] Wave 3.D — P&L drill wired (1/1 smoke PASS)
- [x] Wave 3.E — BS drill wired (1/1 smoke PASS)
- [x] Wave 3.G — PB1 drill wired (1/1 smoke PASS, reusable `useAccountIdByCode` hook)
- [x] Wave 3.H — StockMovementHistory product drill wired (1/1 smoke PASS)
- [x] Wave 3.I — PaymentByMethod drill wired (1/1 smoke PASS)
- [x] Wave 3.J — SalesByHour drill wired (1/1 smoke PASS)
- [x] Wave 4 — `pnpm typecheck` 6/6 PASS + S32 sweep 16 files / 40 tests PASS
- [x] Wave 4 — INDEX written + CLAUDE.md Active Workplan updated

---

## 12. Backlog Vague C remaining (S33+)

Still open from S31 §12 (re-confirmed) :
1. **UnifiedReportFilters extra dims** (category/terminal/customer) on reports beyond OrdersListPage
2. **Compare toggle** sur 5 reports S30 (Wastage/PaymentByMethod/PB1/StockMovements/PerishableTurnover)
3. **Mobile responsive** des detail pages + reports
4. **Hub mini-KPI bar** + favorites/pinning sur ReportsIndexPage
5. **6 Soon cards restantes** (Daily Sales, Purchase ×3, Production Report/Efficiency, Staff Performance, Price Changes, Permission Change Log)

New for S33+ (Vague C close-out leftovers) :
6. **CF account drill** — refactor `get_cash_flow_v1` to surface per-account lines (DEV-S32-1.D-01)
7. **`get_orders_list_v1` v2** — server-side `refund_status`, `hour`, and `terminal_id` filters (DEV-S32-1.E-01/02, DEV-S32-1.A-01)
8. **OrdersListPage enrichments** — refund/void actions, "+ New Order" button, mobile responsive, column visibility toggle
9. **`useAccountIdByCode` consumers** — any other report card showing a single-account KPI (loyalty liability, B2B AR, etc.) can now drill via the same pattern
