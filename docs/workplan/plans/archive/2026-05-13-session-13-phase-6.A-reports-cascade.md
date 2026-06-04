# Session 13 — Phase 6.A — Reports cascade (P&L + BS + Cash Flow + basket)

**Date:** 2026-05-14
**Status:** in-progress
**Wave:** 6 (Reports / Accounting cascade)
**Complexity:** L (~24-30h)
**Migration block:** `20260517000210..000219`
**Extends:** [Phase 2.B Reports infra](./2026-05-13-session-13-phase-2.B-reports-infra.md)

---

## Scope (4 new RPCs + 4 new BO pages)

### RPCs delivered

| # | RPC | Returns | Source data |
|---|-----|---------|-------------|
| 1 | `get_profit_loss_v1(p_date_start, p_date_end, p_section_id := NULL)` | `jsonb` (revenue / cogs / gross / opex / op profit / net profit) | `journal_entry_lines` joined on `accounts.account_class` (4=revenue, 5=COGS, 6=OpEx); subtotals by `account_type` and `code` |
| 2 | `get_balance_sheet_v1(p_as_of_date)` | `jsonb` (assets / liabilities / equity / CYE / balanced) | JE lines aggregated by account_class 1/2/3 up to `p_as_of_date`; CYE = (revenue - COGS - OpEx) YTD computed live |
| 3 | `get_cash_flow_v1(p_date_start, p_date_end)` | `jsonb` (operating / investing / financing / net change) | Indirect method — net profit + adjustments + working capital changes. MVP version: net profit + delta(AR) + delta(AP) + delta(Inventory) for operating ; zeros for investing/financing (placeholder so the structure is in place) |
| 4 | `get_basket_analysis_v1(p_date_start, p_date_end, p_top_n := 10)` | `TABLE(product_id_a, product_a_name, product_id_b, product_b_name, co_occurrence_count, lift, confidence)` | `order_items` pair-joined per order, joined to `products` for names; lift = `P(A∩B)/(P(A)*P(B))`, confidence = `P(B|A)` |

### V3 CoA assumed (audited live via `SELECT * FROM accounts`)

- **1xxx Assets (debit)** — `1110` Cash, `1111` Petty, `1112-1116` banks/clearing, `1131-1132` AR, `1141-1143` Inventory, `1151` VAT input.
- **2xxx Liabilities (credit)** — `2110` PB1 payable, `2141-2143` AP/VAT-out/PB1-tax, `2210` Loyalty.
- **3xxx Equity (credit)** — `3100` Owner Capital, `3300` Current Year Earnings (NON-postable; computed by BS RPC live).
- **4xxx Revenue (credit)** — `4100/4111/4131` Sales lines, `4190/4900` discounts (debit), `4510/4910` adjustments-income / cash-variance-gain.
- **5xxx COGS (debit)** — `5110` Production COGS, `5210` Waste, `5910` Cash-variance loss.
- **6xxx OpEx (debit)** — `6111-6116` Salary/Rent/Utilities/Supplies/Marketing/Maintenance, `6190` Other, `6510` Adjustment expense.

### Migration files (4)

1. `20260517000210_create_pnl_rpc.sql` — `get_profit_loss_v1()`. Aggregates `posted`/`locked` JE lines in `[start, end]`. Groups revenue (class 4 credit-balance) by mapped category, COGS (class 5) and OpEx (class 6) by account code. Net income = revenue - COGS - OpEx.
2. `20260517000211_create_balance_sheet_rpc.sql` — `get_balance_sheet_v1()`. Computes asset/liability/equity balances up to as-of date. CYE = (YTD revenue - COGS - OpEx) calculated from JE lines from `date_trunc('year', p_as_of_date)` through `p_as_of_date`. Balanced flag asserts `|A - (L+E+CYE)| < 0.01`.
3. `20260517000212_create_cash_flow_rpc.sql` — `get_cash_flow_v1()`. Operating section: net profit + Δ(AR) + Δ(AP) + Δ(Inventory). Investing + Financing = 0 placeholder.
4. `20260517000213_create_basket_analysis_rpc.sql` — `get_basket_analysis_v1()`. Self-joins `order_items` on order id, filters distinct pairs (product_id_a < product_id_b), windowed for date range with `orders.paid_at`. Returns top-N by lift.

No MV augmentation needed (`mv_pl_monthly` is sufficient for monthly aggregations but P&L RPC supports arbitrary date ranges so we live-query JE lines and not consume the MV directly — see deviation D-W6-6A-1).

### BO files (extend `apps/backoffice/src/features/reports/`)

**Hooks (new):**
- `useProfitLoss.ts` — wraps `get_profit_loss_v1`.
- `useBalanceSheet.ts` — wraps `get_balance_sheet_v1`.
- `useCashFlow.ts` — wraps `get_cash_flow_v1`.
- `useBasketAnalysis.ts` — wraps `get_basket_analysis_v1`.

**Pages (new):**
- `apps/backoffice/src/pages/reports/ProfitLossPage.tsx`
- `apps/backoffice/src/pages/reports/BalanceSheetPage.tsx`
- `apps/backoffice/src/pages/reports/CashFlowPage.tsx`
- `apps/backoffice/src/pages/reports/BasketAnalysisPage.tsx`

**Updates:**
- `apps/backoffice/src/routes/index.tsx` — 4 routes guarded by `reports.financial.read` (P&L, BS, CF) and `reports.sales.read` (basket).
- `apps/backoffice/src/layouts/BackofficeLayout.tsx` — 4 entries in the Reports group (indent 1).
- `apps/backoffice/src/pages/reports/ReportsIndexPage.tsx` — 4 new cards.

### Tests

**pgTAP:** `supabase/tests/reports_pnl_bs_cf.test.sql` — T_RPT_FIN_01..12. Seeds a journal entry, runs each RPC, asserts shape + sums + balanced.

**Vitest live:** `supabase/tests/functions/reports-financials.test.ts` — PIN login as admin, calls each RPC on empty + seeded windows.

**BO smoke:**
- `apps/backoffice/src/features/reports/__tests__/ProfitLossPage.smoke.test.tsx`
- `apps/backoffice/src/features/reports/__tests__/BalanceSheetPage.smoke.test.tsx`
- `apps/backoffice/src/features/reports/__tests__/CashFlowPage.smoke.test.tsx`
- `apps/backoffice/src/features/reports/__tests__/BasketAnalysisPage.smoke.test.tsx`

---

## Working order

1. Apply migrations 000210..000213 via MCP.
2. Re-gen types and commit.
3. Run pgTAP via MCP `execute_sql` BEGIN/ROLLBACK.
4. Author hooks + pages + tests.
5. `pnpm typecheck`, BO smoke.
6. Commit per logical chunk.

## Deviations from spec

See `docs/workplan/refs/2026-05-14-session-13-wave-6-deviations.md` (created).

- **D-W6-6A-1** — `get_profit_loss_v1` always live-queries JE lines instead of opportunistically consuming `mv_pl_monthly`. Rationale: the MV is monthly-truncated; reusing it for arbitrary [start,end] windows risks off-by-month errors. Volume is low enough (a few hundred lines/day) to query live with proper indexes. The MV remains for the future dashboard tile that needs the last-12-month series.
- **D-W6-6A-2** — `get_cash_flow_v1` MVP only implements the Operating section. Investing / Financing return zero placeholders. Justification: V3 has no fixed-assets module nor loan/financing module yet (CapEx tracking is Wave 8+). Structure remains 3-section so client UI is stable when those sections light up.
