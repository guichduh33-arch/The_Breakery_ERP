# Session 30 — Vague B : 5 reports métier bakery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Livrer 5 nouveaux reports métier (Wastage & Spoilage, Payment by Method, VAT/PB1, Stock Movement history, Perishable Turnover) — promote 5 "Soon" cards du hub à actives, en réutilisant l'infrastructure S29 (ExportButtons, EF generate-pdf, helpers buildCsv).

**Architecture:** Pattern uniforme — 1 RPC SECURITY DEFINER par report retournant JSONB + REVOKE pair canonique S25 + 1 hook BO + 1 page BO + ExportButtons (CSV+PDF) + 1 PDF template dans `_shared/pdf-templates/`. Aucune nouvelle permission, aucune nouvelle table. Migration block `20260615000010..030`.

**Tech Stack:** PostgreSQL Supabase cloud `ikcyvlovptebroadgtvd`, Deno EF avec pdf-lib (extension S29), TypeScript monorepo, React 18, React-Query v5, Vitest, pgTAP.

**Spec:** [`../specs/2026-05-24-session-30-spec.md`](../../specs/archive/2026-05-24-session-30-spec.md)

**Branch:** `swarm/session-30` (déjà créée depuis `master` @ `d14cf9b`)

---

## Wave 0 — Branch + spec commit

### Task 0.1 : Commit spec + plan

- [ ] Add spec + plan files
```bash
git add docs/workplan/specs/2026-05-24-session-30-spec.md docs/workplan/plans/2026-05-24-session-30-plan.md
git commit -m "docs(s30): wave 0 — session 30 spec + plan (Vague B: 5 bakery reports)"
```

---

## Wave 1.A — DB : 3 inventory RPCs

### Task 1.A.1 : `get_wastage_report_v1` + REVOKE pair

**Files:** Create migrations `_010` and `_011` (parallel structure : RPC + REVOKE).

- [ ] Migration `_010` : `get_wastage_report_v1(p_date_start TEXT, p_date_end TEXT) RETURNS JSONB`
- Perm gate `has_permission(auth.uid(), 'reports.inventory.read')`
- Aggregate :
  - **manual_waste** = `stock_movements` rows where `movement_type='waste'` in [start, end]
  - **spoilage** = `stock_lots` rows where `status='expired'` and `expired_at` in [start, end]
- Value = `ABS(quantity) * COALESCE(unit_cost, products.cost_price)`
- Return shape per spec §3.1 — `{ period, summary, by_product[], lines[] }` (lines LIMIT 500)
- Apply via `mcp__69ab635f-2952-471f-8358-d8eb48a4c4df__apply_migration` name=`create_get_wastage_report_v1_rpc`
- Verify : `SELECT proname FROM pg_proc WHERE proname = 'get_wastage_report_v1';` → 1 row

- [ ] Migration `_011` : REVOKE pair canonique
```sql
REVOKE EXECUTE ON FUNCTION get_wastage_report_v1(TEXT, TEXT) FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] Commit
```bash
git add supabase/migrations/20260615000010_create_get_wastage_report_v1_rpc.sql supabase/migrations/20260615000011_revoke_pair_get_wastage_report_v1.sql
git commit -m "feat(db): session 30 — wave 1.A.1 — get_wastage_report_v1 + REVOKE pair"
```

### Task 1.A.2 : `get_stock_movements_v1` + REVOKE pair

**Files:** Migrations `_016` and `_017`.

- [ ] Migration `_016` : cursor-paginé pattern S13 AuditLog
- Signature : `(p_start TEXT, p_end TEXT, p_product_id UUID DEFAULT NULL, p_movement_type TEXT DEFAULT NULL, p_limit INT DEFAULT 50, p_cursor TIMESTAMPTZ DEFAULT NULL)`
- Filters in WHERE clause when args non-NULL
- ORDER BY `created_at DESC`, LIMIT clamped `LEAST(GREATEST(p_limit, 1), 200)`
- Return `{ lines[], next_cursor }` per spec §3.4
- Apply name = `create_get_stock_movements_v1_rpc`

- [ ] Migration `_017` : REVOKE pair (signature `(TEXT, TEXT, UUID, TEXT, INT, TIMESTAMPTZ)`)

- [ ] Commit
```bash
git add supabase/migrations/20260615000016_create_get_stock_movements_v1_rpc.sql supabase/migrations/20260615000017_revoke_pair_get_stock_movements_v1.sql
git commit -m "feat(db): session 30 — wave 1.A.2 — get_stock_movements_v1 (cursor-paginated) + REVOKE pair"
```

### Task 1.A.3 : `get_perishable_turnover_v1` + REVOKE pair

**Files:** Migrations `_018` and `_019`.

- [ ] Migration `_018` :
- Perishable definition : products that have at least one `stock_lots` row with `expires_at NOT NULL` (active or historical)
- For each perishable product :
  - `consumed_qty` = SUM lots where status='consumed' and consumed_at in period
  - `expired_qty`  = SUM lots where status='expired' and expired_at in period
  - `current_active_qty` = SUM lots where status='active' at end of period
  - `avg_days_in_stock` = AVG(EXTRACT(EPOCH FROM (consumed_at - received_at))/86400) on consumed lots
  - `waste_pct` = `expired_qty / NULLIF(consumed_qty + expired_qty, 0) * 100`
  - `velocity_score` (1-5 bucket per spec §3.5)
- Return `{ period, by_product[] }`
- Apply name = `create_get_perishable_turnover_v1_rpc`

- [ ] Migration `_019` : REVOKE pair

- [ ] Commit
```bash
git add supabase/migrations/20260615000018_create_get_perishable_turnover_v1_rpc.sql supabase/migrations/20260615000019_revoke_pair_get_perishable_turnover_v1.sql
git commit -m "feat(db): session 30 — wave 1.A.3 — get_perishable_turnover_v1 + REVOKE pair"
```

---

## Wave 1.B — DB : 2 finance RPCs (parallèle 1.A)

### Task 1.B.1 : `get_payments_by_method_v1` + REVOKE pair

**Files:** Migrations `_012` and `_013`.

- [ ] Migration `_012` :
- Perm gate `reports.financial.read`
- Source `order_payments JOIN orders WHERE orders.status NOT IN ('voided', 'cancelled')`
- Aggregations :
  - `summary.total_amount` = SUM op.amount in period
  - `summary.total_count`  = COUNT(op.*)
  - `summary.total_orders` = COUNT(DISTINCT op.order_id)
  - `by_method[]` = GROUP BY method with `amount`, `count`, `share_pct = amount / summary.total_amount * 100`
  - `by_day[]` = GROUP BY DATE(paid_at) pivoted by method (cash/card/qris/edc/transfer/store_credit/total)
- Period filter on `paid_at` (UTC TZ-safe — use `toLocalDateStr` semantic at boundaries)
- Apply name = `create_get_payments_by_method_v1_rpc`

- [ ] Migration `_013` : REVOKE pair

- [ ] Commit
```bash
git add supabase/migrations/20260615000012_create_get_payments_by_method_v1_rpc.sql supabase/migrations/20260615000013_revoke_pair_get_payments_by_method_v1.sql
git commit -m "feat(db): session 30 — wave 1.B.1 — get_payments_by_method_v1 + REVOKE pair"
```

### Task 1.B.2 : `get_pb1_report_v1` + REVOKE pair

**Files:** Migrations `_014` and `_015`.

- [ ] Migration `_014` :
- Signature `(p_period_month INT, p_period_year INT) RETURNS JSONB`
- Perm gate `reports.financial.read`
- Compute period : `start = make_date(p_period_year, p_period_month, 1)`, `end = (start + interval '1 month' - interval '1 day')::date`
- Use helper `current_pb1_rate()` (S26) for `pb1_rate`
- Aggregations on `orders` where `created_at::date BETWEEN start AND end` and `status NOT IN ('voided', 'cancelled')` :
  - `taxable_base` = SUM `orders.subtotal`
  - `pb1_collected` = SUM `orders.tax_amount`
- `pb1_payable` = call existing `calculate_pb1_payable_v1(start, end)` (S26 helper)
- `balance_at_period_end` = sum of `journal_entry_lines.credit - debit` on account_id where `code='2110'` and `entry_date <= end`
- `by_day[]` = GROUP BY `created_at::date` returning `{ day, taxable_base, pb1_collected }`
- Apply name = `create_get_pb1_report_v1_rpc`

- [ ] Migration `_015` : REVOKE pair (signature `(INT, INT)`)

- [ ] Commit
```bash
git add supabase/migrations/20260615000014_create_get_pb1_report_v1_rpc.sql supabase/migrations/20260615000015_revoke_pair_get_pb1_report_v1.sql
git commit -m "feat(db): session 30 — wave 1.B.2 — get_pb1_report_v1 (monthly NON-PKP) + REVOKE pair"
```

---

## Wave 2 — pgTAP tests

### Task 2.1 : `bakery_reports.test.sql` (15 cas)

**Files:** Create `supabase/tests/bakery_reports.test.sql`.

- [ ] Mirror pattern S28 `expense_governance.test.sql` (use GUCs for chained fixtures).
- 15 cas (3 per report) per spec §6.1.
- Wrap in `BEGIN; ... ROLLBACK;`
- Apply via `mcp__69ab635f-2952-471f-8358-d8eb48a4c4df__execute_sql`
- Expect 15/15 PASS — iterate fixtures if any fail.

- [ ] Commit
```bash
git add supabase/tests/bakery_reports.test.sql
git commit -m "test(db): session 30 — wave 2 — pgTAP bakery_reports 15/15 PASS via cloud MCP"
```

---

## Wave 3 — EF : 5 nouveaux PDF templates + extend registry

### Task 3.1 : Write 5 templates

**Files:** Create in `supabase/functions/_shared/pdf-templates/` :
- `wastage.ts` — sections : header summary + by_product table + (if room) top 10 spoilage lots
- `payment_by_method.ts` — header summary + by_method table (with share_pct bar visual) + by_day mini-table
- `pb1.ts` — header avec mois/année + summary (taxable_base, pb1_collected, pb1_payable) + by_day breakdown
- `stock_movements.ts` — multi-page table ledger (~30 rows/page)
- `perishable_turnover.ts` — by_product table with velocity_score visual indicator (★)

Pattern per template per Wave 3.A.2 in S29 (reference : `pnl.ts`).

- [ ] Commit
```bash
git add supabase/functions/_shared/pdf-templates/wastage.ts supabase/functions/_shared/pdf-templates/payment_by_method.ts supabase/functions/_shared/pdf-templates/pb1.ts supabase/functions/_shared/pdf-templates/stock_movements.ts supabase/functions/_shared/pdf-templates/perishable_turnover.ts
git commit -m "feat(ef): session 30 — wave 3.1 — 5 nouveaux PDF templates (wastage, payment_by_method, pb1, stock_movements, perishable_turnover)"
```

### Task 3.2 : Extend registry `index.ts`

**Files:** Modify `supabase/functions/_shared/pdf-templates/index.ts`.

- [ ] Add 5 imports + extend `TemplateName` union to 17 values + add 5 entries to `TEMPLATES` Record with appropriate permission.

- [ ] Update BO `apps/backoffice/src/features/reports/hooks/useGeneratePdf.ts` — extend `PdfTemplate` type union to match.

- [ ] Re-deploy `generate-pdf` via MCP `mcp__69ab635f-2952-471f-8358-d8eb48a4c4df__deploy_edge_function` name=`generate-pdf` with updated files.

- [ ] Commit
```bash
git add supabase/functions/_shared/pdf-templates/index.ts apps/backoffice/src/features/reports/hooks/useGeneratePdf.ts
git commit -m "feat(ef): session 30 — wave 3.2 — extend pdf-templates registry to 17 (12 + 5 new) + re-deploy generate-pdf"
```

---

## Wave 4 — BO : 5 hooks + 5 pages

### Task 4.1 : 5 hooks

**Files:** Create in `apps/backoffice/src/features/reports/hooks/`:
- `useWastageReport.ts` (useQuery returning WastageReport)
- `usePaymentsByMethod.ts` (useQuery returning PaymentsByMethod)
- `usePb1Report.ts` (useQuery args month + year, returning Pb1Report)
- `useStockMovements.ts` (useInfiniteQuery cursor-paginated, mirror useAuditLogs)
- `usePerishableTurnover.ts` (useQuery returning PerishableTurnover)

Pattern per existing hook (e.g., `useProfitLoss.ts`).

- [ ] Commit
```bash
git add apps/backoffice/src/features/reports/hooks/useWastageReport.ts apps/backoffice/src/features/reports/hooks/usePaymentsByMethod.ts apps/backoffice/src/features/reports/hooks/usePb1Report.ts apps/backoffice/src/features/reports/hooks/useStockMovements.ts apps/backoffice/src/features/reports/hooks/usePerishableTurnover.ts
git commit -m "feat(backoffice): session 30 — wave 4.1 — 5 hooks for bakery reports (useWastageReport, usePaymentsByMethod, usePb1Report, useStockMovements infinite, usePerishableTurnover)"
```

### Task 4.2 : 5 pages + smoke tests

**Files:** Create in `apps/backoffice/src/pages/reports/`:
- `WastagePage.tsx`
- `PaymentByMethodPage.tsx`
- `Pb1ReportPage.tsx` (month picker, not date range)
- `StockMovementHistoryPage.tsx` (cursor-paginated table, Load More button)
- `PerishableTurnoverPage.tsx`

Each with ExportButtons wired (CSV + PDF for inventory pages, CSV + PDF for finance).

Smoke tests `__tests__/<Page>.smoke.test.tsx` — 2 cas per page (render with mock data + ExportButtons present).

- [ ] Commit
```bash
git add apps/backoffice/src/pages/reports/WastagePage.tsx apps/backoffice/src/pages/reports/PaymentByMethodPage.tsx apps/backoffice/src/pages/reports/Pb1ReportPage.tsx apps/backoffice/src/pages/reports/StockMovementHistoryPage.tsx apps/backoffice/src/pages/reports/PerishableTurnoverPage.tsx apps/backoffice/src/pages/reports/__tests__/
git commit -m "feat(backoffice): session 30 — wave 4.2 — 5 new report pages + 10/10 smoke PASS"
```

### Task 4.3 : Routes

**Files:** Modify `apps/backoffice/src/routes/index.tsx`.

- [ ] Add 5 routes with PermissionGate per spec §5.3.
- [ ] Run `pnpm typecheck` — expect 6/6 PASS.

---

## Wave 5 — Hub + Sidebar wire-up

### Task 5.1 : Promote 5 "Soon" cards → actives + add Perishable Turnover card

**Files:** Modify `apps/backoffice/src/pages/reports/ReportsIndexPage.tsx`.

- [ ] Add `to:` to the 4 existing "Soon" cards (Stock Movement, Wastage & Spoilage, Payment by Method, VAT/Tax) per spec §5.4.
- [ ] Add 1 new card "Perishable Turnover" → `to: 'perishable-turnover'` in Inventory section with icon `Clock4`.

### Task 5.2 : 5 sidebar entries

**Files:** Modify `apps/backoffice/src/layouts/Sidebar.tsx`.

- [ ] Add 5 entries per spec §5.3 (indent: 1 sous Reports). Verify perm strings match seeded perms.

- [ ] Run `pnpm typecheck` 6/6 PASS.

- [ ] Run `pnpm --filter @breakery/app-backoffice test` — all PASS.

- [ ] Commit
```bash
git add apps/backoffice/src/pages/reports/ReportsIndexPage.tsx apps/backoffice/src/layouts/Sidebar.tsx apps/backoffice/src/routes/index.tsx
git commit -m "feat(backoffice): session 30 — wave 5 — promote 5 'Soon' cards to active + 5 sidebar entries + 5 routes wired"
```

---

## Wave 6 — Closeout

### Task 6.1 : Full sweep

- [ ] Run via MCP `execute_sql` :
  - `supabase/tests/bakery_reports.test.sql` (S30) → 15/15 PASS
  - `supabase/tests/zreports.test.sql` (S29 regression) → 14/14 PASS
  - `supabase/tests/expense_governance.test.sql` (S28 regression) → 18/18 PASS

- [ ] `pnpm --filter @breakery/app-backoffice test` — all PASS, count.
- [ ] `pnpm --filter @breakery/app-pos test` — all PASS, count.
- [ ] `pnpm typecheck` — 6/6 PASS.

### Task 6.2 : INDEX + CLAUDE.md + backlog

- [ ] Write `docs/workplan/plans/2026-05-24-session-30-INDEX.md` (mirror S29 INDEX format, 12 sections).
- [ ] Update `CLAUDE.md` Active Workplan : new top entry for S30, demote S29 to reference.
- [ ] Update `docs/workplan/backlog-by-module/14-reports-analytics.md` : status notes pour 5 nouveaux items.
- [ ] Update `docs/workplan/backlog-by-module/00-roadmap-globale.md` : new S30 row in sessions table.

- [ ] Commit
```bash
git add docs/workplan/plans/2026-05-24-session-30-INDEX.md CLAUDE.md docs/workplan/backlog-by-module/
git commit -m "docs(s30): wave 6 — INDEX + CLAUDE.md Active Workplan + backlog status notes (S30 closeout)"
```

### Task 6.3 : Push + PR

```bash
git push -u origin swarm/session-30
gh pr create --base master --head swarm/session-30 --title "Session 30 — Vague B: 5 bakery reports" --body "..."
```

---

## Self-review checklist

- [x] All 5 reports have RPC + REVOKE pair planned (10 migrations)
- [x] Permissions are reused (no new perms)
- [x] EF generate-pdf registry extension covered
- [x] BO pages + hooks + routes + sidebar all listed
- [x] Hub promotion of 5 "Soon" cards covered
- [x] Tests : pgTAP 15 cas + BO smoke 10 cas + 0 new EF tests (covered by S29 generic path)
- [x] Closeout includes regression sweep S28 + S29
- [x] No placeholders, exact file paths, complete code intent per task

**Total estimate** : ~32 tasks, ~20 commits, 10 migrations, 0 new EFs (extend existing), 5 PDF templates, 5 hooks, 5 pages, ~15 pgTAP + 10 BO smoke tests. **Effort L (~2-3j wall-time)**.
