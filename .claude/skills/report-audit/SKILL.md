---
name: report-audit
description: >
  Systematic AUDITOR of the V3 backoffice reports/analytics module (apps/backoffice) — scans the ~28 report
  pages across the full V3 stack (report RPC → React Query hook → page component → Recharts/tables → CSV/PDF
  export) to find broken data bindings, dead RPC/view references, type-vs-payload mismatches, decorative date
  filters, misleading charts (dual-axis, missing stackId, duplicate render), and coverage gaps. Produces a
  prioritized audit report (P0–P3) then offers interactive fixes one by one. Complementary to the
  `reports-exports` skill (which GUIDES building/wiring reports) — this skill FINDS bugs. Use whenever the
  user reports a broken/inaccurate report, a chart that "doesn't match the data", missing reports, graph
  errors, analytics inconsistencies, a date picker that doesn't filter, or wants a quality audit of reports.
  DEFER: money/fraud/RBAC integrity → security-fraud-guard ; CLAUDE.md pattern compliance of a diff →
  pattern-guardian ; JE/COA/PB1 math correctness → accounting ; WAC/recipe-cost/inventory math →
  stock-management ; building a NEW report or export wiring → reports-exports.
pathPatterns:
  - 'apps/backoffice/src/features/reports/**'
  - 'apps/backoffice/src/pages/reports/**'
  - 'packages/domain/src/reports/**'
promptSignals:
  phrases:
    - 'report audit'
    - 'audit reports'
    - 'broken report'
    - 'report bug'
    - 'inaccurate report'
    - 'chart issue'
    - 'graph error'
    - "chart doesn't match"
    - 'bars don\'t match'
    - 'missing report'
    - 'report data inconsistency'
    - 'analytics problem'
    - 'date filter not working'
    - 'report quality'
    - 'verify reports'
---

# Report Audit — The Breakery V3 (apps/backoffice)

Systematic auditor for the V3 reporting module. Reads the **real** code across the V3 stack to find errors,
inconsistencies, and gaps — then proposes interactive fixes one by one with user confirmation.

**This is the AUDIT skill.** Its sibling `reports-exports` is the GUIDE/BUILD skill (surface map, how to wire
a new report, export pipeline). When you need the canonical surface map (full RPC list, 17 PDF templates,
Z-report flow, drill-down entities), read `reports-exports` instead of re-deriving it. `CLAUDE.md` is the
source of truth for global patterns (RPC versioning, REVOKE pair S25, PIN header, idempotency).

## When to Use

- A report shows wrong / missing / empty data
- A chart "doesn't match the data" or "the bars are wrong"
- A date picker appears decorative (data doesn't change on date change)
- Hunting for missing reports / coverage gaps
- Periodic quality pass after a schema or RPC change

## DEFER (do NOT do here)

- **Money/fraud/RBAC integrity, audit-log completeness, anon hardening** → `security-fraud-guard`
- **CLAUDE.md pattern compliance of a branch/diff** (REVOKE pairs, append-only ledgers, versioning) → `pattern-guardian`
- **Accounting math** (JE balance, COA mapping, PB1 formula, trial-balance correctness) → `accounting`
- **Inventory/WAC/recipe-cost/production math** → `stock-management`
- **Building a NEW report, export wiring, Z-report flow, drill-down entity** → `reports-exports`

This skill owns **report correctness as displayed**: does the page fetch the right RPC, map the payload to
the right fields, and render a chart that truthfully represents the data?

## V3 Architecture Context (verified)

There is **no `services/reporting` layer and no central `ReportsConfig`** (those were V2). The V3 data flow:

```
Supabase RPC (SECURITY DEFINER, _vN, REVOKE pair S25)
  → React Query hook            apps/backoffice/src/features/reports/hooks/use<Name>.ts
    → Page component            apps/backoffice/src/pages/reports/<Name>Page.tsx
      → Recharts + tables + KPI cards   (shared: ChartCard, CostDonut, chartColors)
        → Export                ExportButtons → buildCsv (domain) + useGeneratePdf (generate-pdf EF)
```

### Where things actually live (V3)

| Layer | Location | Notes |
|-------|----------|-------|
| Report pages | `apps/backoffice/src/pages/reports/*.tsx` | ~28 pages, one per report (no central config) |
| Hub | `apps/backoffice/src/pages/reports/ReportsIndexPage.tsx` | static cards, not a config file |
| Routing | `apps/backoffice/src/routes/index.tsx` | lazy routes, each wrapped in `<PermissionGate required="reports.*.read">` |
| Hooks | `apps/backoffice/src/features/reports/hooks/use*.ts` | one per report; each calls one RPC via React Query |
| Shared components | `apps/backoffice/src/features/reports/components/` | ExportButtons, ChartCard, CostDonut, DateRangePicker(WithCompare), DeltaPct, DrilldownLink |
| Report-local utils | `apps/backoffice/src/features/reports/utils/` | `buildDrilldownUrl.ts`, `chartColors.ts` |
| Domain helpers (pure TS) | `packages/domain/src/reports/` | `csv.ts`, `period.ts`, `toLocalDateStr.ts`, `aggregations.ts` |
| Types | **co-located with each hook** + `packages/domain/src/reports` | no central `types/reporting.ts` |
| Report RPCs | `supabase/migrations/*report*.sql` (+ others) | `get_<name>_v1/v2`, SECURITY DEFINER |
| PDF | `supabase/functions/generate-pdf/` + `_shared/pdf-templates/` | 17-template registry (see reports-exports) |

### V3 conventions (verified — use these, not the V2 ones)

- **Currency: IDR.** Formatters `formatIdrFull` / `formatIdrCompact` in `features/reports/utils/chartColors.ts`; CSV uses the `'idr-round100'` format (rounds to nearest 100) from `packages/domain/src/reports/csv.ts`. Locale `'id-ID'`.
- **Timezone: `Asia/Makassar` (UTC+8).** Use `toLocalDateStr()` / `toLocalDayStartUTC()` from `packages/domain/src/reports/toLocalDateStr.ts` for date-column comparisons — **`.toISOString()` slices for a local-date filter are an off-by-one bug.** (This helper DOES exist in V3.)
- **No i18n.** No `useTranslation` / i18next. BO UI strings are hardcoded (French UI, English/French in code). Don't flag missing `t()`.
- **`select('*')` is mostly N/A** at the hook layer — report data comes from RPCs. The equivalent check lives **inside the RPC's SQL** and in any page that queries a table directly (e.g. an audit/log page). Flag `select('*')` only where a component/RPC actually does a raw select.
- **Permissions are route-level** via `<PermissionGate required="reports.<domain>.read">` in `routes/index.tsx` (codes: `reports.read`, `reports.sales.read`, `reports.inventory.read`, `reports.financial.read`, `reports.audit.read`). There is **no `useReportPermissions` hook**.
- **Build/test is pnpm + turbo**, never `npm`. This is a Vite+React SPA (no Next.js). DB targets Supabase **cloud** V3 dev `ikcyvlovptebroadgtvd` via MCP (Docker retired) — verify RPC/view existence by reading `supabase/migrations/` or `mcp__plugin_supabase_supabase__execute_sql`, **never** `supabase db reset`.

## Audit Process

Read **actual** code — don't guess. Hooks are small; RPC SQL lives in `supabase/migrations/` (grep the RPC
name, read the body). For a single-report complaint, jump to **Single-Report Mode** at the end.

### Phase 1 — Wiring integrity

1. Read `routes/index.tsx` → list every `/reports/*` route, its lazy component, and its `PermissionGate` code.
2. Read `ReportsIndexPage.tsx` → list every card/tile.
3. Cross-reference page files in `pages/reports/` against routes and hub tiles.

Findings:
- `UNROUTED` — page file exists but no route (unreachable)
- `NO_HUB_TILE` — routed report not surfaced on the hub
- `DEAD_ROUTE` — route points to a missing/renamed component
- `PERM_MISMATCH` — route gate code doesn't match the report's domain (e.g. a finance report gated `reports.sales.read`)

### Phase 2 — RPC ↔ schema ↔ payload verification (highest-value)

For each report's hook, follow the chain hook → RPC → typed interface.

**a) RPC exists & is the right version.** The hook calls `supabase.rpc('get_<name>_vN', {...})`. Grep
`supabase/migrations/` for `get_<name>_v` — confirm the called version exists and isn't superseded by a
later `_vN+1` the hook forgot to adopt. Missing RPC → runtime crash.

**b) Argument names match.** The hook passes `p_date_start`, `p_date_end`, `p_section_id`, etc. Confirm the
RPC signature uses exactly those param names/types. A renamed param silently fails or errors.

**c) Payload → interface alignment.** Hooks map the RPC JSON/rows into a co-located TS interface (see
`useProfitLoss.ts` `ProfitLoss`). Read the RPC's `RETURNS`/`SELECT` and confirm every interface field is
actually produced. Flag:
- `DEAD_FIELD` — interface field the RPC never returns → always `0`/`undefined`
- `PLACEHOLDER` — hardcoded dummy in the hook/page (e.g. `items_sold: 0`)

**d) Date filter actually applied (P0 class).** If the page has a date range but the RPC ignores it (no
`p_date_start`/`p_date_end` in the call, or the RPC body doesn't filter on them), the picker is decorative.
Verify the dates reach the RPC **and** the query key includes them so React Query refetches.

**e) Inside-RPC column checks** (read the RPC SQL): wrong column/relationship names, `select *` in the body,
and date comparisons that should respect `Asia/Makassar`. For deep accounting/stock correctness, DEFER to
`accounting` / `stock-management`.

Findings: `MISSING_RPC`, `STALE_RPC_VERSION`, `WRONG_ARG`, `DEAD_FIELD`, `PLACEHOLDER`, `DATE_IGNORED`,
`WRONG_COLUMN`, `SELECT_STAR`, `TIMEZONE_BUG`.

### Phase 3 — Component-level audit

For each page component:
- **Query key completeness** — every filter (date range, section, category) is in the React Query key, else stale data on filter change (`STALE_QUERY`).
- **Field consumption** — JSX/table/export reference only fields the hook returns (`EXPORT_MISMATCH` when an `ExportButtons` CSV column accessor points at a field the payload lacks → empty column).
- **States** — optional chaining on async data (`NULL_CRASH`), empty state (`NO_EMPTY_STATE`), loading skeleton, error propagation.
- **Right data source** — page uses the hook intended for it (`WRONG_HOOK`).

### Phase 4 — Chart & graph coherence (Recharts)

Most "it looks wrong" bugs live here. For every component using Recharts:

**4A Data binding**
- `WRONG_DATAKEY` — `dataKey` on `<Bar>/<Line>/<Pie>/<Area>` (and `XAxis dataKey`) must match a real key in the data array. Grep the hook for the field name.
- `DUPLICATE_RENDER` — same `dataKey` on both `<Bar>` and `<Line>` → duplicate tooltip/legend entries.

**4B Scale & axis truthfulness**
- `DUAL_AXIS_MISLEADING` — a `ComposedChart` with two `<YAxis>` auto-scales each axis independently; a Rp 500K profit line can sit as tall as a Rp 50M revenue bar. The #1 "chart doesn't match data" cause. Check whether series share `yAxisId`; if a dual axis is intended, it must be clearly labeled/distinguished.
- `MISSING_STACKID` — bars described as "stacked" (COGS + expenses) must share a `stackId`; without it Recharts renders them grouped, contradicting the label.

**4C Tooltip & legend**
- `TOOLTIP_ERROR` — custom formatter must output the right unit (IDR via `formatIdrFull`, %, count).
- Legend `name` props human-readable ("Revenue" not "total_revenue"); custom legend lookup maps cover all keys.

**4D Visual integrity**
- `NO_RESPONSIVE` — every chart wrapped in `<ResponsiveContainer>`.
- Pie slices sum to the expected total; color semantics consistent (use `chartColors.ts` ramps: COGS blue / OpEx amber; red=loss, green=profit).
- `CHART_TABLE_ORDER` — chart chronological (oldest→left) while table is reverse-chronological (newest→top) confuses "first bar vs first row".

**4E Comparison charts** — `previousPeriod()` from `packages/domain/src/reports/period.ts` is calendar-aware (full-month vs n-day shift); verify "current vs previous" math and graceful empty-previous handling. Wired on the 5 compare reports (P&L, BS, CF, SalesByHour, SalesByCategory).

### Phase 5 — Cross-cutting

- **Permission coverage** — confirmed at route level (Phase 1). Reports must not be reachable by URL without the gate.
- **Export coverage** — tabular reports offer CSV via `ExportButtons`; confirm CSV columns map to real payload fields and use the right `CsvFormat` (`idr-round100` for money).
- **Accessibility** — charts need an aria-label / sr-only summary.
- **Business rules** — flag *suspicious* outputs (e.g. "Net Revenue" equal to gross, i.e. tax not removed) but **DEFER the actual math** to `accounting` (PB1 is NON-PKP, computed server-side in `get_pb1_report_v1`).

### Phase 6 — Gap analysis

- **Unused data sources** — list `view_*` / report RPCs in migrations not consumed by any hook (e.g. check `view_production_summary`, `view_b2b_performance`, `promotion_usage` if present).
- **Missing bakery-critical reports** — production vs sales (demand planning), ingredient consumption, supplier scoring, recipe-cost trend — note as gaps if absent.
- **Chart/export opportunities** — table-only reports that would benefit from a chart; reports lacking CSV/PDF.

## Output Format

```markdown
# Report Module Audit — [DATE]

## Executive Summary
- Reports audited: X/~28 · Issues: P0:X P1:X P2:X P3:X · Charts audited: X · Gaps: X

## P0 — Critical (broken / crashing / decorative date filter)
### [ID] [Report] — [Type]
**Location**: `path:line`  **Problem**: …  **Impact**: …  **Fix**: …

## P1 — High (wrong data / misleading charts)
## P2 — Medium (missing states / export gaps)
## P3 — Low (style / readability)

## Coverage Gaps
## Chart Coherence Summary
| Report | Chart | dataKey | Axes | Stack | Tooltip | Responsive | Issues |
```

## Interactive Fix Phase

1. Present the full audit report.
2. Ask: "I found X issues. Want me to fix them, P0 first, showing each fix before applying?"
3. Per issue, in priority order: show current snippet → explain → show proposed fix → wait for confirmation → apply → note related updates (co-located types, smoke test, ExportButtons columns).
4. **If you touch the working tree, isolate first** (this repo enforces a worktree for edits in background jobs) and after fixes run:
   ```bash
   pnpm typecheck
   pnpm --filter @breakery/app-backoffice test reports
   pnpm --filter @breakery/domain test reports
   ```
5. If a fix changed a report **RPC**, regen types via `mcp__plugin_supabase_supabase__generate_typescript_types` → write to `packages/supabase/src/types.generated.ts`, and consider running `pattern-guardian` on the diff (REVOKE pair, versioning).
6. Summarize all changes.

The user is always in control — they can skip, modify, or stop at any point.

## Single-Report Mode

When the user names one report (or complains it "looks wrong"):
1. Locate its three artifacts: `pages/reports/<Name>Page.tsx`, `features/reports/hooks/use<Name>.ts`, and the backing `get_<name>_vN` RPC in migrations.
2. Run Phase 2 (hook→RPC→interface) and Phase 3 on just that report.
3. Run Phase 4 on every chart in the page — this is where most "it looks wrong" bugs live.
4. Skip Phases 1/5/6 unless asked.

Most common chart root causes: **dual Y-axis with independent scales**, **missing `stackId`**, **chart vs
table ordering**, **duplicate Bar+Line on one dataKey**.

## Known baseline (don't flag as new)

- Env-gated live tests (`generate-pdf`, Vitest live RPC) **fail without `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`** exported — that's the known baseline, not a report bug.
- DB is cloud-only (Docker retired). Verify RPC/view existence by reading migrations or MCP `execute_sql`, never `supabase db reset`.
