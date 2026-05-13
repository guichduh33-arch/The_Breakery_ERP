# Session 13 — Wave 6 Deviation Pack

**Date opened:** 2026-05-14
**Status:** open — appended as Wave 6 phases land.

This document records intentional deviations between the Wave 6
INDEX/spec and the SQL/code that actually landed on staging
`ikcyvlovptebroadgtvd` and in the repo. Each entry covers cause +
resolution + verification, mirroring the prior wave deviation packs.

---

## Phase 6.A — Reports cascade (P&L + BS + Cash Flow + basket)

### D-W6-6A-1 — `get_profit_loss_v1` live-queries JE lines, does NOT consume `mv_pl_monthly`

**INDEX spec says:** "Use `mv_pl_monthly` when the period aligns to month boundaries; else live query."

**What landed:** `supabase/migrations/20260517000210_create_pnl_rpc.sql`
always queries `journal_entry_lines` directly, regardless of whether
`[p_date_start, p_date_end]` aligns to month boundaries.

#### Cause

The MV `mv_pl_monthly` (built in Phase 2.B migration `…000070`) is keyed
on `date_trunc('month', je.entry_date)::date`. To reuse it safely for
the new RPC we would need a branch that detects "start = first-of-month
AND end = last-of-month for one or more contiguous months" and falls
back to live mode otherwise. That branching code introduces an edge
case (DST month boundaries, period straddling year-end, etc.) for a
gain that doesn't materialise: live JE-line aggregation on the staging
data set returns in under 30 ms thanks to the index
`journal_entry_lines_journal_entry_id_idx` plus the
`journal_entries_entry_date_idx` filter pushdown.

#### Resolution

P&L RPC live-queries JE lines. `mv_pl_monthly` is **kept** because it
remains the right source for the dashboard's "last 12 months trend"
tile (Phase 6.B+) where the query is rigorously monthly-truncated.

#### Verification

- pgTAP `T_RPT_FIN_03` asserts revenue/COGS/OpEx sums match a seeded JE.
- Vitest `reports-financials.test.ts` calls `get_profit_loss_v1` for the
  current month and asserts the structure.

---

### D-W6-6A-2 — `get_cash_flow_v1` MVP implements Operating section only

**INDEX spec says:** "Indirect method: starts from net profit, adjusts
for non-cash + working capital changes. Sections: Operating / Investing
/ Financing."

**What landed:** `supabase/migrations/20260517000212_create_cash_flow_rpc.sql`
implements the full 3-section JSON structure but `investing` and
`financing` always return zero. Only `operating` is computed.

#### Cause

V3 currently has neither:
- A fixed-assets / CapEx module (would feed Investing — purchase of
  equipment, sale of asset, etc.). Planned for Wave 8.
- A loans / shareholder-funding module (would feed Financing — proceeds
  from debt, dividend, capital injection). Not in session 13 scope.

Operating uses the indirect method with available signals: net profit
+ Δ(AR) + Δ(AP) + Δ(Inventory). Non-cash adjustments (depreciation,
amortisation) are zero because the underlying entries don't exist yet.

#### Resolution

The RPC's JSON output retains the full 3-section shape (`operating`,
`investing`, `financing`, `net_change_in_cash`). Client UI renders all
three sections so the visual is stable when Wave 8+ flips the zeros to
real numbers.

#### Verification

- pgTAP `T_RPT_FIN_07` asserts `investing = 0` and `financing = 0`.
- Vitest live `reports-financials.test.ts` asserts the JSON shape.
- BO smoke `CashFlowPage.smoke.test.tsx` renders all three section
  headings without throwing.

---

### D-W6-6A-3 — Permission gate for financial reports = `reports.financial.read` (existing)

**INDEX spec says:** "Permission-gated".

**What landed:** P&L, BS, Cash Flow routes guarded by
`reports.financial.read` (already seeded for ADMIN / MANAGER /
SUPER_ADMIN in `role_permissions`). Basket analysis uses
`reports.sales.read` because it operates on sales line data and follows
the same gating as `sales-by-category`.

#### Cause

Pre-existing permission codes already cover this scope. Creating new
codes would duplicate semantics without functional benefit.

#### Resolution

No new permission codes introduced — only `PermissionGate` wrappers
referencing existing ones.

#### Verification

- `pnpm typecheck` green (no new `PermissionCode` literals).
- Routes load correctly when authenticated as ADMIN.
