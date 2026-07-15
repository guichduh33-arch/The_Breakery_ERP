# Phase 2.B — Reports infra + 5 first reports (sub-plan)

> Session 13 / Wave 2 / Phase 2.B. Build the foundational reports
> infrastructure: 3 materialised views (sales-daily, stock-variance,
> P&L-monthly) + pg_cron refresh + 5 first reports RPCs + 5 BO pages +
> a TZ-aware date helper (`toLocalDateStr`) + cursor pagination for the
> audit log.
>
> Date: 2026-05-14. Branch: `swarm/session-13`. Subagent: `reports-infra`.
> Migration block: `20260517000070..000076` (7 migrations).
> INDEX line 493.

---

## 0. Pre-flight findings (read first)

| Topic | Finding |
|---|---|
| Migration drift | Cloud `supabase_migrations.schema_migrations` lists nothing past `20260516000021`, but spot-checks (`pg_proc`, `information_schema.tables`) confirm 20260517 Wave-1 objects exist (e.g. `accounting_mappings`, `stock_lots`, refactored `create_sale_journal_entry`, `record_stock_movement_v1`, `has_permission`, `audit_logs`). They were applied via raw `execute_sql` (not `apply_migration`). **Action:** use `apply_migration` for each of our 7 files so the ledger is rebuilt correctly going forward. |
| `pg_cron` | Installed (`pg_cron 1.6.4` in `pg_catalog`). No DB cost (Pro plan). |
| Timezone | DB session `Asia/Makassar`, `business_config.timezone = 'Asia/Makassar'`. RPCs MUST bucket via `(created_at AT TIME ZONE bc.timezone)`, not `current_setting('TimeZone')`. |
| INDEX vs reality (table names) | INDEX says `pos_orders` + `pos_order_items` — actual canonical names are `orders` + `order_items` (cf. `20260503000003_init_pos.sql`). All RPCs target the real names. |
| INDEX vs reality (audit_logs columns) | INDEX says `resource_type / resource_id` — actual columns are `entity_type / entity_id` (cf. `20260503000005_init_settings.sql` + `20260517000034_drop_legacy_audit_log_singular.sql`). RPC signature uses real column names. `audit_logs.id` is BIGSERIAL (`bigint`), not UUID — RPC returns `id BIGINT`. |
| `staff` table | Does not exist as a separate table. Staff identity = `user_profiles` (`id`, `full_name`, `employee_code`). `orders.served_by` references `user_profiles(id)`. RPC uses `user_profiles` joined on `served_by`. |
| Categories link | `products.category_id → categories(id)` (NOT NULL on products). |
| Sections / stock | `stock_movements.from_section_id`, `to_section_id` exist. `section_stock(section_id, product_id, quantity, unit)` exists. `products.cost_price`, `products.unit` exist. |
| Existing perms | `reports.read`, `reports.export` only. INSERT 4 new gates: `reports.sales.read`, `reports.inventory.read`, `reports.audit.read`, `reports.financial.read`. **No `has_permission()` re-CREATE.** |
| Recharts | Not installed. Need to add `recharts ^2.13.0` to `apps/backoffice/package.json` (Recharts 3.x has React 18.3 peer warnings ; the audit doc references 3.6 but we standardize on 2.13 for stable peer match). |
| Existing TZ helper | `toLocalDateStr` does not exist anywhere in `apps/`, `packages/`. No `format(.*'yyyy-MM-dd'...)` stragglers either — clean slate for the helper. |
| `audit_log` (singular view) | Kept as deprecated compat view (`20260517000034`). Our RPC reads `audit_logs` (plural) directly. |

**Net deviations from INDEX (logged in `2026-05-14-session-13-wave-2-deviations.md`):**

1. Tables: `orders` + `order_items` (not `pos_orders`/`pos_order_items`).
2. Audit columns: `entity_type` + `entity_id` (not `resource_type`/`resource_id`). `id` is BIGINT.
3. Staff RPC uses `user_profiles` (no dedicated `staff` table).
4. Recharts pinned at `^2.13.0` (not 3.6).
5. Permissions: introduce 4 sub-permissions (`reports.sales.read`, `reports.inventory.read`, `reports.audit.read`, `reports.financial.read`) and grant them to admin + manager roles. Sidebar/route gating uses the closest match (sales→`reports.sales.read`, stock-variance→`reports.inventory.read`, audit→`reports.audit.read`).
6. Migration ledger: use `apply_migration` for proper tracking — Wave-1 history may be reconstructed in a follow-up commit if needed (out of scope here).

---

## 1. Sequence (file-by-file)

### 1.A — Sub-plan + deviations (this commit)
- `docs/workplan/plans/2026-05-13-session-13-phase-2.B-reports-infra.md` (this file).
- `docs/workplan/refs/2026-05-13-session-13-wave-2-deviations.md` — create/append Phase 2.B section.
- Commit `docs(workplan): session 13 — phase 2.B — sub-plan + deviations`.

### 1.B — Pure domain helpers (TDD)
- `packages/domain/src/reports/toLocalDateStr.ts` — `(date: Date | string, tz?: string) => 'YYYY-MM-DD'`. Uses `Intl.DateTimeFormat` with `timeZone` option ; default `Asia/Makassar`.
- `packages/domain/src/reports/aggregations.ts` — pure helpers `sumByHour`, `sumByCategory`, `sumByStaff`, `computeStockVariance` (used by tests + as offline fallback). No I/O.
- `packages/domain/src/reports/index.ts` — re-exports.
- `packages/domain/src/index.ts` — `export * from './reports/index.js'`.
- `packages/domain/src/reports/__tests__/toLocalDateStr.test.ts`, `aggregations.test.ts`.
- Commit `feat(domain): session 13 — phase 2.B — toLocalDateStr + report aggregations`.

### 1.C — Migration 1 (MV init) via MCP
- `supabase/migrations/20260517000070_init_materialised_views.sql`
- Creates `mv_sales_daily`, `mv_stock_variance`, `mv_pl_monthly` + UNIQUE indexes (CONCURRENTLY-capable refresh).
- `mv_sales_daily(business_date DATE PK, total_sales DECIMAL, total_orders INT, avg_basket DECIMAL)` — sourced from `orders WHERE status='paid' AND voided_at IS NULL`, bucketed by `(paid_at AT TIME ZONE bc.timezone)::date`.
- `mv_stock_variance(product_id UUID PK, opened DECIMAL, sold DECIMAL, adjusted DECIMAL, current_qty DECIMAL, expected DECIMAL, variance DECIMAL)` — derived from `stock_movements` SUMs grouped by product (snapshot of all-time).
- `mv_pl_monthly(month DATE PK, revenue DECIMAL, cogs DECIMAL, gross_profit DECIMAL)` — revenue from `orders` ; COGS from `journal_entries` posted to 5110/5101 (or whichever COGS account in `accounting_mappings`). Falls back to 0 if `journal_entries` table absent for backward compat.
- Apply via `apply_migration` (name `init_materialised_views`).
- `BEGIN; SELECT REFRESH MATERIALIZED VIEW mv_sales_daily; ... ROLLBACK;` smoke test — verify population works on empty data (zero rows OK).

### 1.D — Migration 2 (pg_cron refresh + wrapper fns)
- `supabase/migrations/20260517000071_pg_cron_refresh_mv.sql`
- Wrapper functions `refresh_mv_sales_daily()`, `refresh_mv_stock_variance()`, `refresh_mv_pl_monthly()` — SECURITY DEFINER, `SET search_path = public`. Use `REFRESH MATERIALIZED VIEW CONCURRENTLY` (requires the unique indexes from 000070).
- `cron.schedule('refresh-mv-sales-daily',    '5 * * * *',  'SELECT public.refresh_mv_sales_daily()')`
- `cron.schedule('refresh-mv-stock-variance', '*/15 * * * *', 'SELECT public.refresh_mv_stock_variance()')`
- `cron.schedule('refresh-mv-pl-monthly',     '0 2 * * *',  'SELECT public.refresh_mv_pl_monthly()')`
- Apply via `apply_migration`. Quick smoke: `SELECT public.refresh_mv_sales_daily()` returns `void`.

### 1.E — Migrations 3-6 (5 report RPCs)
Each migration is one file, ~80-120 lines, SECURITY INVOKER (so RLS on underlying tables applies) but `STABLE` and `SET search_path = public`. RPC body uses MV where horizon allows, otherwise live query. All RPCs do *not* require any permission row (gating is at the BO route layer); we still grant `EXECUTE ON FUNCTION … TO authenticated`.

- `20260517000072_create_sales_by_hour_rpc.sql` — `get_sales_by_hour_v1(p_date DATE) RETURNS TABLE(hour INT, total DECIMAL, order_count INT)`. Bucketing by `EXTRACT(HOUR FROM paid_at AT TIME ZONE bc.timezone)`. Live query (orders + bc timezone) — MV not used because hour granularity is too fine for a daily MV.
- `20260517000073_create_sales_by_category_rpc.sql` — `get_sales_by_category_v1(p_date_start DATE, p_date_end DATE) RETURNS TABLE(category_id UUID, category_name TEXT, total DECIMAL, qty NUMERIC)`. Joins orders → order_items → products → categories. Excludes cancelled lines (`is_cancelled = false`). Bucket on `(paid_at AT TIME ZONE bc.timezone)::date BETWEEN p_date_start AND p_date_end`.
- `20260517000074_create_sales_by_staff_rpc.sql` — `get_sales_by_staff_v1(p_date_start DATE, p_date_end DATE) RETURNS TABLE(staff_id UUID, staff_name TEXT, total DECIMAL, order_count INT, avg_basket DECIMAL)`. Groups by `orders.served_by`, joins `user_profiles`. Excludes voided orders.
- `20260517000075_create_stock_variance_rpc.sql` — `get_stock_variance_v1(p_section_id UUID DEFAULT NULL, p_date_start TIMESTAMPTZ DEFAULT NULL, p_date_end TIMESTAMPTZ DEFAULT NULL) RETURNS TABLE(product_id UUID, product_name TEXT, opened DECIMAL, sold DECIMAL, adjusted DECIMAL, current_qty DECIMAL, expected DECIMAL, variance DECIMAL, variance_pct DECIMAL)`. Window = `coalesce(p_date_start, now() - interval '30 days')` → `coalesce(p_date_end, now())`. Aggregates `stock_movements` by product_id (and optional section filter via `from_section_id`/`to_section_id`).

### 1.F — Migration 7 (audit cursor pagination + permissions seed)
- `supabase/migrations/20260517000076_paginate_audit_log_rpc.sql`
- `get_audit_logs_v1(p_cursor TIMESTAMPTZ DEFAULT NULL, p_limit INT DEFAULT 50, p_actor_id UUID DEFAULT NULL, p_action TEXT DEFAULT NULL, p_entity_type TEXT DEFAULT NULL) RETURNS TABLE(id BIGINT, actor_id UUID, action TEXT, entity_type TEXT, entity_id UUID, metadata JSONB, created_at TIMESTAMPTZ)`. Cursor-based: `WHERE (p_cursor IS NULL OR created_at < p_cursor) ORDER BY created_at DESC LIMIT LEAST(p_limit, 200)`. Clamp limit to 200 max. SECURITY INVOKER.
- Same migration also INSERTs the 4 new permission rows + grants them to roles `ADMIN`, `MANAGER` (idempotent via ON CONFLICT DO NOTHING ; uses existing `role_permissions` linking table).

### 1.G — Types regen + commit
- `mcp__plugin_supabase_supabase__generate_typescript_types(project_id='ikcyvlovptebroadgtvd')`.
- Write to `packages/supabase/src/types.generated.ts`.
- Commit `chore(types): regen types.generated.ts after phase 2.B migrations`.

### 1.H — pgTAP test (single file)
- `supabase/tests/reports.test.sql` — T_RPT_01..04 (MV existence + indexes ; sales-by-hour seed + assert ; stock-variance non-trivial ; audit cursor pagination).
- Run via `execute_sql` with `BEGIN ... ROLLBACK` envelope.

### 1.I — Vitest live RPC test
- `supabase/tests/functions/reports-sales.test.ts` — login → seed 3 paid orders at different hours → assert `get_sales_by_hour_v1` buckets.
- `supabase/tests/functions/reports-audit.test.ts` — seed 5 audit rows → cursor walk through pages of 2.

### 1.J — Recharts dep + BO feature folder
- `apps/backoffice/package.json` — add `recharts: ^2.13.0`.
- `apps/backoffice/src/features/reports/hooks/` — 5 hooks (one per RPC).
- `apps/backoffice/src/features/reports/components/` — reusable bits (date pickers, KPI cards).
- `apps/backoffice/src/features/reports/__tests__/SalesByHourPage.smoke.test.tsx`.

### 1.K — BO pages
- `apps/backoffice/src/pages/reports/SalesByHourPage.tsx`
- `apps/backoffice/src/pages/reports/SalesByCategoryPage.tsx`
- `apps/backoffice/src/pages/reports/SalesByStaffPage.tsx`
- `apps/backoffice/src/pages/reports/StockVariancePage.tsx`
- `apps/backoffice/src/pages/reports/AuditPage.tsx`

### 1.L — Routes + sidebar
- `apps/backoffice/src/routes/index.tsx` — replace the placeholder `<ComingSoonPage module="Reports" />` with a Reports index page (lists the 5 reports), and add 5 child routes gated by the 4 new permissions.
- `apps/backoffice/src/layouts/BackofficeLayout.tsx` — expand the Reports nav entry into a parent group with 5 children; rely on `useAuthStore.hasPermission` to hide entries the user can't see.

### 1.M — Final wrap
- `pnpm install` (Recharts).
- `pnpm --filter @breakery/domain test reports` — pure domain green.
- `pnpm --filter @breakery/app-backoffice test reports` — smoke test green.
- `pnpm typecheck` — turbo green.
- `pnpm build` — turbo green.
- Wave-2 deviations file updated with any drift.
- Commit `feat(reports): session 13 — phase 2.B — BO pages + sidebar`.

---

## 2. DoD checklist (mirror INDEX)

- [ ] 7 migrations applied via `apply_migration` (ledger updated).
- [ ] `SELECT public.refresh_mv_sales_daily();` returns `void` on empty data ; same for the 2 other MVs.
- [ ] `mcp__plugin_supabase_supabase__generate_typescript_types` regen → `packages/supabase/src/types.generated.ts` committed.
- [ ] `pnpm typecheck` green.
- [ ] 5 BO reports pages render (smoke tests assert headings + RPC calls).
- [ ] `toLocalDateStr()` exported from `@breakery/domain` ; consumers BO use it for filter dates.
- [ ] Audit pagination is cursor-based (no `LIMIT 5000` or offset patterns in the new RPC ; grep gate proves it).
- [ ] pgTAP + Vitest live green.
- [ ] Commits squash-mergeable with Claude co-author.

---

## 3. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `mv_pl_monthly` depends on `journal_entries` shape that may shift later. | Build COGS subquery defensively (`COALESCE(SUM(...), 0)`) and add a comment that this view may be re-issued after `accounting_mappings` lock-down. |
| `REFRESH MATERIALIZED VIEW CONCURRENTLY` needs a unique index. | Every MV has a single-column PK-style UNIQUE index ; verified at create time. |
| pg_cron jobs collide with Wave 1 `pg_cron_mark_expired_lots`. | Job names namespaced (`refresh-mv-*`) ; verified no collision. |
| RLS on `audit_logs` may filter rows the BO needs. | RPC is `SECURITY INVOKER` ; gating happens at the BO route layer through `reports.audit.read`. Manager/admin grants cover the use-case. |
| Sale JE refactor reads `pos_orders` (sic) — confirm `mv_pl_monthly` reads correctly. | `mv_pl_monthly` reads `orders` directly (not via the JE) so it is decoupled from the JE refactor. JE is only used to back-fill COGS. |

---

## 4. Hand-off

When done → SendMessage `lead` with: migrations applied list, MV smoke result, file list, test green count, typecheck result, commits SHA list.
