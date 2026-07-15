# S70 — Rapport écarts de caisse par caissier — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the manager a Back-Office report that aggregates shift-close cash variance per cashier, with a day-of-week breakdown, to spot a recurring shortfall by cashier (fiche 12 D2.4).

**Architecture:** One read-only `plpgsql` RPC `get_cashier_variance_v1(date, date)` returning a JSONB envelope (per-cashier summary over 3 volets + cash day-of-week matrix + grand totals), aggregating `pos_sessions` grouped by `opened_by`; cash variance from the frozen `pos_sessions.variance_total` column, QRIS/card variance from the frozen `audit_logs` `shift.close` metadata. A BO page under `features/reports` mirrors the existing `SalesByStaffPage`. **Zero DB writes, no money-path bump, no destructive migration.**

**Tech Stack:** Supabase Postgres (cloud V3 dev `ikcyvlovptebroadgtvd`, via MCP), React 18 + TanStack Query v5 + Tailwind + `@breakery/ui` / `@breakery/domain`, Vitest smoke, pgTAP.

## Global Constraints

- **DB target = Supabase cloud V3 dev `ikcyvlovptebroadgtvd` via MCP only.** No Docker, no `supabase db reset`, no `run_pgtap.sh`.
- **Controller-only steps (subagents cannot reach MCP):** `apply_migration`, `generate_typescript_types`, all pgTAP runs, any live SQL verification. Subagents may *author* SQL/test files; the controller applies and runs them.
- **Migration numbering monotonic** — next free NAME-block number is `20260710000140` (highest on master = `20260710000139`).
- **Trio S20 on every new RPC:** `REVOKE ALL … FROM PUBLIC, anon;` + `GRANT EXECUTE … TO authenticated;` + `COMMENT ON FUNCTION …`.
- **No `BEGIN;`/`COMMIT;` inside a migration body** — MCP `apply_migration` already wraps in a transaction.
- **Always regen types after the schema change** and commit `packages/supabase/src/types.generated.ts`. If the MCP generator diverges (drift on `get_stock_levels_v1` / internal `_*` fns, cf. DEV-S69-03), **graft**: start from the master types file, add only the `get_cashier_variance_v1` delta.
- **Permission gate = `reports.read`** on the RPC AND the route/sidebar/tile (kept coherent on purpose).
- **Cashier attribution = `pos_sessions.opened_by`.** Cash variance sign: `variance_total < 0` = short (manque), `> 0` = over.
- **Branch:** `swarm/session-70` (already created, base master `1b1e68eb`). Conventional commits, co-author Claude.
- Spec: `docs/superpowers/specs/2026-07-08-s70-cashier-variance-report-design.md`.

---

### Task 1: RPC `get_cashier_variance_v1` (migration `20260710000140`)

**Files:**
- Create: `supabase/migrations/20260710000140_get_cashier_variance_v1.sql`

**Interfaces:**
- Consumes (existing, unchanged): `pos_sessions(opened_by, closed_by, closed_at, status, variance_total, counted_qris, counted_card, id)`, `audit_logs(action, entity_type, entity_id, metadata, created_at)` where the `shift.close` row's `metadata` carries `variance_qris` / `variance_card`, `user_profiles(id, full_name)`, `business_config(id=1, timezone)`, `has_permission(uuid, text)`.
- Produces: `public.get_cashier_variance_v1(p_start_date date, p_end_date date) RETURNS jsonb` — envelope `{ generated_at, start_date, end_date, timezone, cashiers[], totals }`. Each cashier: `{ cashier_id, cashier_name, sessions_count, cash{total_variance,avg_variance,total_short,short_count,over_count,worst_variance}, qris{counted_sessions,total_variance}, card{counted_sessions,total_variance}, dow_cash[{dow,sessions,total_variance}] }`. `cashiers` sorted by `cash.total_short` ASC (biggest cumulative shortfall first).

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260710000140_get_cashier_variance_v1.sql`:

```sql
-- S70 (fiche 12 D2.4) — Cashier cash/QRIS/card variance report.
-- Read-only aggregation over closed shifts, grouped by pos_sessions.opened_by.
-- Cash variance = frozen pos_sessions.variance_total; QRIS/card variance =
-- frozen audit_logs 'shift.close' metadata (no recompute → stable over time).
-- Gated reports.read. No writes. Money-path untouched.

CREATE OR REPLACE FUNCTION public.get_cashier_variance_v1(
  p_start_date date,
  p_end_date   date
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz       TEXT;
  v_cashiers JSONB;
  v_totals   JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.read') THEN
    RAISE EXCEPTION 'permission denied: reports.read required' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_date > p_end_date THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  -- Normalized per-session rows for the window (shared shape below).
  WITH sessions AS (
    SELECT
      ps.opened_by                                           AS cashier_id,
      ps.variance_total                                      AS cash_var,
      ps.counted_qris                                        AS counted_qris,
      ps.counted_card                                        AS counted_card,
      CASE WHEN ps.counted_qris IS NOT NULL
           THEN (sc.metadata->>'variance_qris')::numeric END AS qris_var,
      CASE WHEN ps.counted_card IS NOT NULL
           THEN (sc.metadata->>'variance_card')::numeric END AS card_var,
      EXTRACT(DOW FROM (ps.closed_at AT TIME ZONE v_tz))::int AS dow
    FROM pos_sessions ps
    LEFT JOIN LATERAL (
      SELECT al.metadata
        FROM audit_logs al
       WHERE al.action = 'shift.close'
         AND al.entity_type = 'pos_sessions'
         AND al.entity_id = ps.id
       ORDER BY al.created_at DESC
       LIMIT 1
    ) sc ON TRUE
    WHERE ps.status = 'closed'
      AND ps.closed_at IS NOT NULL
      AND ps.opened_by IS NOT NULL
      AND ((ps.closed_at AT TIME ZONE v_tz))::date BETWEEN p_start_date AND p_end_date
  ),
  per_cashier AS (
    SELECT
      s.cashier_id,
      COUNT(*)                                                   AS sessions_count,
      COALESCE(SUM(s.cash_var), 0)                               AS cash_total,
      COALESCE(SUM(s.cash_var) FILTER (WHERE s.cash_var < 0), 0) AS cash_short,
      COUNT(*) FILTER (WHERE s.cash_var < 0)                     AS short_count,
      COUNT(*) FILTER (WHERE s.cash_var > 0)                     AS over_count,
      COALESCE(MIN(s.cash_var), 0)                               AS worst_var,
      COUNT(*) FILTER (WHERE s.counted_qris IS NOT NULL)         AS qris_sessions,
      COALESCE(SUM(s.qris_var), 0)                               AS qris_total,
      COUNT(*) FILTER (WHERE s.counted_card IS NOT NULL)         AS card_sessions,
      COALESCE(SUM(s.card_var), 0)                               AS card_total
    FROM sessions s
    GROUP BY s.cashier_id
  ),
  dow_by_cashier AS (
    SELECT d.cashier_id,
           jsonb_agg(jsonb_build_object(
             'dow', d.dow, 'sessions', d.sessions, 'total_variance', d.total_variance
           ) ORDER BY d.dow) AS dow_cash
    FROM (
      SELECT s.cashier_id, s.dow,
             COUNT(*) AS sessions,
             COALESCE(SUM(s.cash_var), 0) AS total_variance
        FROM sessions s
       GROUP BY s.cashier_id, s.dow
    ) d
    GROUP BY d.cashier_id
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'cashier_id',     pc.cashier_id,
      'cashier_name',   COALESCE(up.full_name, '—'),
      'sessions_count', pc.sessions_count,
      'cash', jsonb_build_object(
        'total_variance', pc.cash_total,
        'avg_variance',   ROUND(pc.cash_total / NULLIF(pc.sessions_count, 0), 2),
        'total_short',    pc.cash_short,
        'short_count',    pc.short_count,
        'over_count',     pc.over_count,
        'worst_variance', pc.worst_var
      ),
      'qris', jsonb_build_object('counted_sessions', pc.qris_sessions, 'total_variance', pc.qris_total),
      'card', jsonb_build_object('counted_sessions', pc.card_sessions, 'total_variance', pc.card_total),
      'dow_cash', COALESCE(dc.dow_cash, '[]'::jsonb)
    ) ORDER BY pc.cash_short ASC
  )
  INTO v_cashiers
  FROM per_cashier pc
  JOIN user_profiles up ON up.id = pc.cashier_id
  LEFT JOIN dow_by_cashier dc ON dc.cashier_id = pc.cashier_id;

  -- Grand totals over the same window.
  WITH sessions AS (
    SELECT ps.variance_total AS cash_var, ps.counted_qris, ps.counted_card,
           CASE WHEN ps.counted_qris IS NOT NULL THEN (sc.metadata->>'variance_qris')::numeric END AS qris_var,
           CASE WHEN ps.counted_card IS NOT NULL THEN (sc.metadata->>'variance_card')::numeric END AS card_var
      FROM pos_sessions ps
      LEFT JOIN LATERAL (
        SELECT al.metadata FROM audit_logs al
         WHERE al.action = 'shift.close' AND al.entity_type = 'pos_sessions' AND al.entity_id = ps.id
         ORDER BY al.created_at DESC LIMIT 1
      ) sc ON TRUE
     WHERE ps.status = 'closed' AND ps.closed_at IS NOT NULL AND ps.opened_by IS NOT NULL
       AND ((ps.closed_at AT TIME ZONE v_tz))::date BETWEEN p_start_date AND p_end_date
  )
  SELECT jsonb_build_object(
    'sessions_count', COUNT(*),
    'cash', jsonb_build_object(
      'total_variance', COALESCE(SUM(cash_var), 0),
      'total_short',    COALESCE(SUM(cash_var) FILTER (WHERE cash_var < 0), 0),
      'short_count',    COUNT(*) FILTER (WHERE cash_var < 0),
      'over_count',     COUNT(*) FILTER (WHERE cash_var > 0)
    ),
    'qris', jsonb_build_object('counted_sessions', COUNT(*) FILTER (WHERE counted_qris IS NOT NULL), 'total_variance', COALESCE(SUM(qris_var), 0)),
    'card', jsonb_build_object('counted_sessions', COUNT(*) FILTER (WHERE counted_card IS NOT NULL), 'total_variance', COALESCE(SUM(card_var), 0))
  ) INTO v_totals
  FROM sessions;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'start_date',   p_start_date,
    'end_date',     p_end_date,
    'timezone',     v_tz,
    'cashiers',     COALESCE(v_cashiers, '[]'::jsonb),
    'totals',       COALESCE(v_totals, jsonb_build_object('sessions_count', 0))
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_cashier_variance_v1(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cashier_variance_v1(date, date) TO authenticated;
COMMENT ON FUNCTION public.get_cashier_variance_v1(date, date) IS
  'S70 fiche 12 D2.4 — read-only cashier cash/QRIS/card variance aggregation by opened_by over a date range; gated reports.read. No writes.';
```

- [ ] **Step 2: Apply the migration** — **CONTROLLER (MCP)**

Call `mcp__claude_ai_Supabase__apply_migration` with `project_id='ikcyvlovptebroadgtvd'`, `name='get_cashier_variance_v1'`, `query=` the file body above (without any `BEGIN;`/`COMMIT;`).

- [ ] **Step 3: Live smoke — verify it runs and gates** — **CONTROLLER (MCP)**

`mcp__claude_ai_Supabase__execute_sql`:
```sql
SELECT public.get_cashier_variance_v1(CURRENT_DATE - 30, CURRENT_DATE);
```
Expected: a JSONB object with keys `generated_at, start_date, end_date, timezone, cashiers, totals` (running as the MCP service role, the `has_permission` gate is satisfied; `cashiers` may be `[]` on the dev DB if no closed sessions in range — that is fine).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260710000140_get_cashier_variance_v1.sql
git commit -m "feat(reports): get_cashier_variance_v1 — cashier shift variance aggregation (S70, fiche 12 D2.4)"
```

> After commit, the controller inserts the migration bookkeeping row into `supabase_migrations.schema_migrations` manually if needed (local clock UTC+8), per the migration-bookkeeping caveat.

---

### Task 2: Regen TypeScript types

**Files:**
- Modify: `packages/supabase/src/types.generated.ts`

**Interfaces:**
- Consumes: the deployed `get_cashier_variance_v1` from Task 1.
- Produces: a `Functions['get_cashier_variance_v1']` entry with `Args: { p_start_date: string; p_end_date: string }` and `Returns: Json` so `supabase.rpc('get_cashier_variance_v1', …)` typechecks in Task 4.

- [ ] **Step 1: Regen types** — **CONTROLLER (MCP)**

Call `mcp__claude_ai_Supabase__generate_typescript_types` (`project_id='ikcyvlovptebroadgtvd'`). Diff the output against the current `packages/supabase/src/types.generated.ts`.

- [ ] **Step 2: Apply the delta (graft if the generator drifts)**

If the diff is clean (only adds `get_cashier_variance_v1`), write the full regen output to `packages/supabase/src/types.generated.ts`. **If the generator diverges** (removes `get_stock_levels_v1`, injects internal `_*` functions — cf. DEV-S69-03), **graft instead**: keep the master file and insert only the `get_cashier_variance_v1` block into `Functions`, e.g.:

```ts
      get_cashier_variance_v1: {
        Args: { p_start_date: string; p_end_date: string }
        Returns: Json
      }
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @breakery/supabase typecheck`
Expected: PASS (exit 0).

- [ ] **Step 4: Commit**

```bash
git add packages/supabase/src/types.generated.ts
git commit -m "chore(types): regen for get_cashier_variance_v1 (S70)"
```

---

### Task 3: pgTAP suite `cashier_variance`

**Files:**
- Create: `supabase/tests/cashier_variance.test.sql`

**Interfaces:**
- Consumes: deployed `get_cashier_variance_v1`.
- Produces: a pgTAP suite proving aggregation, `opened_by` attribution (incl. manager-closed session), tz bucketing, QRIS/card sourcing from audit metadata (incl. pre-S67 session with no keys), date-range filtering, and the `reports.read` gate.

- [ ] **Step 1: Author the test file**

Create `supabase/tests/cashier_variance.test.sql`. **First read `supabase/tests/dashboard_overview.test.sql`** and copy its auth-preamble pattern (sets `request.jwt.claims` to an admin `auth_user_id`; the acting profile has `reports.read`) and its "capture pass/fail into a temp table" MCP-run pattern. Then seed and assert:

```sql
-- cashier_variance.test.sql — S70 fiche 12 D2.4.
-- Run via MCP execute_sql inside BEGIN … ROLLBACK. Mirror the auth preamble +
-- pass/fail capture of dashboard_overview.test.sql.
--
-- SEED (inside the transaction, after the auth preamble):
--  - 2 cashier user_profiles: CASHIER_A, CASHIER_B (full_name known).
--  - business_config.id=1 timezone = 'Asia/Makassar' (already seeded).
--  - pos_sessions (status='closed', closed_at set, opened_by = cashier):
--      A1: opened_by=A, closed_by=A, closed_at = a Tuesday 10:00 local, variance_total = -50000,
--          counted_qris = 100000, counted_card = NULL
--      A2: opened_by=A, closed_by=A, closed_at = the next Tuesday 10:00 local, variance_total = -30000
--      A3: opened_by=A, closed_by=MANAGER (≠ A), closed_at = a Wednesday, variance_total = +10000
--      B1: opened_by=B, closed_by=B, closed_at = a Monday, variance_total = -5000
--      OUT: opened_by=A, closed_at = 90 days ago (outside the queried window) — must be excluded
--  - audit_logs 'shift.close' rows for A1 with metadata {variance_qris: -2000, variance_card: null},
--      and NONE for A2 (pre-S67 simulation → qris/card NULL there).
--
-- Then: SELECT public.get_cashier_variance_v1(CURRENT_DATE - 30, CURRENT_DATE) INTO a jsonb var.

-- ASSERTIONS (is/ok):
--  T1  cashiers array length = 2 (A and B; OUT excluded by window).
--  T2  cashier A is first (biggest cumulative short: -80000 < -5000).
--  T3  A.cash.total_variance = -70000  (-50000 -30000 +10000).
--  T4  A.cash.total_short   = -80000  (only the two negatives).
--  T5  A.cash.short_count = 2, A.cash.over_count = 1.
--  T6  A.cash.worst_variance = -50000.
--  T7  A.sessions_count = 3  (A1,A2,A3 — attributed by opened_by; A3 counts for A although MANAGER closed it).
--  T8  A.qris.counted_sessions = 1 and A.qris.total_variance = -2000 (only A1 had counted_qris + metadata).
--  T9  A.card.counted_sessions = 0 and A.card.total_variance = 0 (no counted_card anywhere for A).
--  T10 A.dow_cash contains dow=2 (Tuesday) with sessions=2 and total_variance = -80000.
--  T11 totals.sessions_count = 4 (A1,A2,A3,B1) and totals.cash.total_short = -85000.
--  T12 invalid_date_range: calling get_cashier_variance_v1(CURRENT_DATE, CURRENT_DATE - 1) raises (throws_ok / P0001).
--  T13 GATE: reset request.jwt.claims to a profile WITHOUT reports.read → call raises 42501 (throws_ok).
--  T14 GATE: reset request.jwt.claims to anon (no claims) → auth.uid() NULL → raises 42501.
--
-- SELECT finish();
```

Fill in the concrete seed INSERTs and `is(...)` / `throws_ok(...)` assertions following the reference file. Use `jsonb` path extraction, e.g. `(v_result->'cashiers'->0->'cash'->>'total_variance')::numeric`. For dow assertions, locate the element with `jsonb_path_query` or a lateral filter on `->>'dow' = '2'`.

- [ ] **Step 2: Run the suite** — **CONTROLLER (MCP)**

Run the whole file via `mcp__claude_ai_Supabase__execute_sql` wrapped in `BEGIN … ROLLBACK`, using the temp-table pass/fail capture (execute_sql returns only the last statement, so aggregate `not ok` count — see `workflow_pgtap_via_mcp_capture`).
Expected: **14/14 pass, 0 `not ok`.**

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/cashier_variance.test.sql
git commit -m "test(reports): cashier_variance pgTAP — aggregation, opened_by attribution, tz, gate (S70)"
```

---

### Task 4: BO hook `useCashierVariance`

**Files:**
- Create: `apps/backoffice/src/features/reports/hooks/useCashierVariance.ts`

**Interfaces:**
- Consumes: `supabase.rpc('get_cashier_variance_v1', { p_start_date, p_end_date })` (typed via Task 2).
- Produces: `useCashierVariance(start: string, end: string)` → TanStack query of `CashierVarianceReport`, and the exported types `CashierVarianceReport`, `CashierVarianceRow`, `DowCell`. Used by Task 5.

- [ ] **Step 1: Write the hook**

Create `apps/backoffice/src/features/reports/hooks/useCashierVariance.ts`:

```ts
// apps/backoffice/src/features/reports/hooks/useCashierVariance.ts
//
// Wraps `get_cashier_variance_v1(p_start_date, p_end_date)` — read-only cashier
// shift-variance report (fiche 12 D2.4). Returns a JSONB envelope.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface DowCell {
  dow:            number; // 0=Sunday … 6=Saturday
  sessions:       number;
  total_variance: number;
}

export interface CashierVarianceRow {
  cashier_id:     string;
  cashier_name:   string;
  sessions_count: number;
  cash: {
    total_variance: number;
    avg_variance:   number;
    total_short:    number;
    short_count:    number;
    over_count:     number;
    worst_variance: number;
  };
  qris: { counted_sessions: number; total_variance: number };
  card: { counted_sessions: number; total_variance: number };
  dow_cash: DowCell[];
}

export interface CashierVarianceReport {
  generated_at: string;
  start_date:   string;
  end_date:     string;
  timezone:     string;
  cashiers:     CashierVarianceRow[];
  totals: {
    sessions_count: number;
    cash: { total_variance: number; total_short: number; short_count: number; over_count: number };
    qris: { counted_sessions: number; total_variance: number };
    card: { counted_sessions: number; total_variance: number };
  };
}

export const CASHIER_VARIANCE_QK = ['reports', 'cashier-variance'] as const;

export function useCashierVariance(start: string, end: string) {
  return useQuery<CashierVarianceReport>({
    queryKey: [...CASHIER_VARIANCE_QK, start, end] as const,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_cashier_variance_v1', {
        p_start_date: start,
        p_end_date:   end,
      });
      if (error) {
        if (error.code === '42501') throw new Error('permission_denied');
        throw error;
      }
      return data as unknown as CashierVarianceReport;
    },
  });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @breakery/backoffice typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/backoffice/src/features/reports/hooks/useCashierVariance.ts
git commit -m "feat(reports): useCashierVariance hook (S70)"
```

---

### Task 5: BO page `CashierVariancePage` + route + sidebar + index tile

**Files:**
- Create: `apps/backoffice/src/pages/reports/CashierVariancePage.tsx`
- Modify: `apps/backoffice/src/routes/index.tsx` (lazy import near line 54; `<Route>` after the `sales-by-staff` block near line 664)
- Modify: `apps/backoffice/src/layouts/Sidebar.tsx` (Reports group, near line 144)
- Modify: `apps/backoffice/src/pages/reports/ReportsIndexPage.tsx` (tiles array, near line 42)

**Interfaces:**
- Consumes: `useCashierVariance`, `CashierVarianceReport`/`CashierVarianceRow`/`DowCell` (Task 4); `ReportPage`, `DateRangePicker`, `ExportButtons`, `useUrlState`, `toLocalDateStr`, `CsvColumn` (existing).
- Produces: route `reports/cashier-variance`, sidebar entry, index tile — all gated `reports.read`.

- [ ] **Step 1: Write the page**

Create `apps/backoffice/src/pages/reports/CashierVariancePage.tsx`:

```tsx
// apps/backoffice/src/pages/reports/CashierVariancePage.tsx
//
// Cashier shift-variance report (fiche 12 D2.4). One row per cashier (3 volets)
// sorted by biggest cumulative cash shortfall, plus a cash day-of-week matrix.
// Read-only. CSV export of the summary table (no PDF in v1).

import { toLocalDateStr } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import { useUrlState } from '@/hooks/useUrlState.js';
import { useCashierVariance } from '@/features/reports/hooks/useCashierVariance.js';
import type { CashierVarianceRow } from '@/features/reports/hooks/useCashierVariance.js';

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const csvColumns: CsvColumn<CashierVarianceRow>[] = [
  { header: 'Cashier',       accessor: (r) => r.cashier_name,          format: 'text' },
  { header: 'Sessions',      accessor: (r) => r.sessions_count,        format: 'number' },
  { header: 'Cash Variance', accessor: (r) => r.cash.total_variance,   format: 'idr-round100' },
  { header: 'Cash Avg',      accessor: (r) => r.cash.avg_variance,     format: 'idr-round100' },
  { header: 'Short #',       accessor: (r) => r.cash.short_count,      format: 'number' },
  { header: 'Over #',        accessor: (r) => r.cash.over_count,       format: 'number' },
  { header: 'Worst',         accessor: (r) => r.cash.worst_variance,   format: 'idr-round100' },
  { header: 'QRIS Variance', accessor: (r) => r.qris.total_variance,   format: 'idr-round100' },
  { header: 'Card Variance', accessor: (r) => r.card.total_variance,   format: 'idr-round100' },
];

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000));
}

function varianceClass(v: number): string {
  if (v < 0) return 'text-danger';
  if (v > 0) return 'text-success';
  return 'text-text-secondary';
}

function fmt(v: number): string {
  return Math.round(v).toLocaleString();
}

export default function CashierVariancePage() {
  const [start, setStart] = useUrlState('start', defaultStart());
  const [end,   setEnd]   = useUrlState('end', toLocalDateStr(new Date()));
  const { data, isLoading, error } = useCashierVariance(start, end);

  const rows = data?.cashiers ?? [];

  return (
    <ReportPage
      title="Cashier Variance"
      subtitle="Shift-close cash / QRIS / card variance per cashier, with a cash day-of-week breakdown."
      isEmpty={!isLoading && !error && rows.length === 0}
      emptyState={{
        title: 'No closed shifts',
        description: 'No shift was closed in the selected date range.',
      }}
      filters={
        <div className="flex items-center gap-3">
          <DateRangePicker start={start} end={end} onStartChange={setStart} onEndChange={setEnd} />
          {rows.length > 0 && (
            <ExportButtons
              csv={{ rows, columns: csvColumns, filename: `cashier-variance-${start}_${end}` }}
            />
          )}
        </div>
      }
    >
      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error.message === 'permission_denied'
            ? 'You do not have permission to view this report.'
            : (error.message ?? 'Failed to load report.')}
        </p>
      )}
      {!isLoading && !error && rows.length > 0 && (
        <div className="space-y-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-text-secondary border-b border-border-subtle">
                <th className="py-2 text-left">Cashier</th>
                <th className="py-2 text-right">Sessions</th>
                <th className="py-2 text-right">Cash Δ</th>
                <th className="py-2 text-right">Avg</th>
                <th className="py-2 text-right">Short</th>
                <th className="py-2 text-right">Over</th>
                <th className="py-2 text-right">Worst</th>
                <th className="py-2 text-right">QRIS Δ</th>
                <th className="py-2 text-right">Card Δ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.cashier_id} className="border-b border-border-subtle">
                  <td className="py-2">{r.cashier_name}</td>
                  <td className="py-2 text-right tabular-nums">{r.sessions_count}</td>
                  <td className={`py-2 text-right tabular-nums ${varianceClass(r.cash.total_variance)}`}>{fmt(r.cash.total_variance)}</td>
                  <td className="py-2 text-right tabular-nums">{fmt(r.cash.avg_variance)}</td>
                  <td className="py-2 text-right tabular-nums">{r.cash.short_count}</td>
                  <td className="py-2 text-right tabular-nums">{r.cash.over_count}</td>
                  <td className={`py-2 text-right tabular-nums ${varianceClass(r.cash.worst_variance)}`}>{fmt(r.cash.worst_variance)}</td>
                  <td className="py-2 text-right tabular-nums">{r.qris.counted_sessions === 0 ? '—' : fmt(r.qris.total_variance)}</td>
                  <td className="py-2 text-right tabular-nums">{r.card.counted_sessions === 0 ? '—' : fmt(r.card.total_variance)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Cash variance by day of week — the "recurring shortfall on Tuesdays" signal. */}
          <div>
            <h3 className="text-sm font-medium mb-2">Cash variance by day of week</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-text-secondary border-b border-border-subtle">
                  <th className="py-2 text-left">Cashier</th>
                  {DOW_LABELS.map((d) => (
                    <th key={d} className="py-2 text-right">{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const byDow = new Map(r.dow_cash.map((c) => [c.dow, c.total_variance]));
                  return (
                    <tr key={r.cashier_id} className="border-b border-border-subtle">
                      <td className="py-2">{r.cashier_name}</td>
                      {DOW_LABELS.map((_, dow) => {
                        const v = byDow.get(dow);
                        return (
                          <td key={dow} className={`py-2 text-right tabular-nums ${v === undefined ? 'text-text-secondary' : varianceClass(v)}`}>
                            {v === undefined ? '·' : fmt(v)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </ReportPage>
  );
}
```

> **Token note:** `text-danger` / `text-success` / `text-text-secondary` / `border-border-subtle` are the semantic tokens already used across `pages/reports/*` (see `SalesByStaffPage`). Do **not** hardcode hex — the ESLint palette lock will fail CI. If `text-success` is not a valid token in this app, use the same positive-value token the other report pages use (grep `pages/reports` for the convention) rather than inventing one.

- [ ] **Step 2: Register the lazy import + route** in `apps/backoffice/src/routes/index.tsx`

Add near the other report lazies (~line 54):
```tsx
const CashierVariancePage = lazy(() => import('@/pages/reports/CashierVariancePage.js'));
```
Add the `<Route>` immediately after the `reports/sales-by-staff` block (~line 664):
```tsx
        <Route
          path="reports/cashier-variance"
          element={
            <PermissionGate required="reports.read">
              <CashierVariancePage />
            </PermissionGate>
          }
        />
```

- [ ] **Step 3: Add the sidebar entry** in `apps/backoffice/src/layouts/Sidebar.tsx` (Reports group, near the `sales-by-staff` line ~144):
```tsx
          { to: '/backoffice/reports/cashier-variance', label: 'Cashier Variance', icon: Wallet, permission: 'reports.read' },
```
> Use an icon already imported in `Sidebar.tsx` from `lucide-react`. If `Wallet` is not already imported, either add it to the existing `lucide-react` import or reuse one already imported (e.g. `Users` / `Coins`). Keep the import list valid.

- [ ] **Step 4: Add the index tile** in `apps/backoffice/src/pages/reports/ReportsIndexPage.tsx` (tiles array, near line 42):
```tsx
      { to: 'cashier-variance', title: 'Cashier Variance', blurb: 'Cash / QRIS / card variance per cashier, by day of week.', icon: Wallet },
```
> Same icon caveat as Step 3 — use an icon already imported in `ReportsIndexPage.tsx`.

- [ ] **Step 5: Verify typecheck + build**

Run: `pnpm --filter @breakery/backoffice typecheck && pnpm --filter @breakery/backoffice build`
Expected: PASS (exit 0).

- [ ] **Step 6: Commit**

```bash
git add apps/backoffice/src/pages/reports/CashierVariancePage.tsx apps/backoffice/src/routes/index.tsx apps/backoffice/src/layouts/Sidebar.tsx apps/backoffice/src/pages/reports/ReportsIndexPage.tsx
git commit -m "feat(reports): Cashier Variance page + route + sidebar + index tile (S70)"
```

---

### Task 6: BO smoke test for `CashierVariancePage`

**Files:**
- Create: `apps/backoffice/src/features/reports/__tests__/CashierVariancePage.smoke.test.tsx`

**Interfaces:**
- Consumes: `CashierVariancePage`, mocked `useCashierVariance`.

- [ ] **Step 1: Write the smoke test**

First read an existing report smoke test (`apps/backoffice/src/features/reports/__tests__/SalesByHourPage.smoke.test.tsx` or `ReportPage.emptyState.smoke.test.tsx`) to copy the render harness (QueryClient + MemoryRouter wrapper, how the hook is mocked with `vi.mock`). Then create `apps/backoffice/src/features/reports/__tests__/CashierVariancePage.smoke.test.tsx` asserting:

```tsx
// Mirror the existing report smoke harness. Mock useCashierVariance.
// Cases:
//  1. Data with one cashier (cash.total_variance = -50000, qris.counted_sessions=0)
//     → renders the cashier name, renders '—' in the QRIS cell, renders the
//       "Cash variance by day of week" heading.
//  2. Empty (cashiers: []) → renders the empty state "No closed shifts".
//  3. Loading → renders "Loading…".
```

Use a mocked report object matching `CashierVarianceReport` (include `dow_cash: [{ dow: 2, sessions: 1, total_variance: -50000 }]`). Keep mock data in `vi.hoisted` stable refs (project lesson: unstable mock data OOMs render loops).

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @breakery/backoffice test cashier-variance`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/backoffice/src/features/reports/__tests__/CashierVariancePage.smoke.test.tsx
git commit -m "test(reports): CashierVariancePage smoke (S70)"
```

---

### Task 7: Pattern-guardian review + closeout

**Files:**
- Create: `docs/workplan/plans/2026-07-08-session-70-INDEX.md`
- Modify: `docs/workplan/remise-a-plat/12-cash-register-shift.md` (mark D2.4 ✅)
- Modify: `docs/workplan/remise-a-plat/00-INDEX.md` (module 12 line)
- Modify: `CLAUDE.md` (Active Workplan — In flight / Merged)

- [ ] **Step 1: Pattern-guardian review**

Dispatch the `pattern-guardian` agent (read-only) on the branch diff. Confirm: no raw `stock_movements`/`order` writes (there are none — read-only RPC), trio S20 present, no money-path bump, RPC versioning fine (new v1), no anon grant. Fix any Critical/Important it raises.

- [ ] **Step 2: Full monorepo verification** — **CONTROLLER**

Run: `pnpm typecheck && pnpm build && pnpm test`
Expected: typecheck + build exit 0; test exit 0 (with the project's env baseline). Record the result.

- [ ] **Step 3: Re-run the money-path anchor** — **CONTROLLER (MCP)**

Run the `s44_money_gates` pgTAP anchor (read the file `supabase/tests/s44_money_gates.test.sql`, execute via MCP BEGIN/ROLLBACK). Expected: 12/12, `num_failed=0` — proving the read-only report changed nothing on the money-path.

- [ ] **Step 4: Write the closeout INDEX** `docs/workplan/plans/2026-07-08-session-70-INDEX.md` — summary of delivered RPC/UI/tests, migration `20260710000140`, any deviations `DEV-S70-0N`, debts `D-1..`, test results.

- [ ] **Step 5: Bump the fiche + 00-INDEX + CLAUDE.md** — mark fiche 12 D2.4 ✅ (S70), update the module-12 line in `00-INDEX.md` (« restent D2.4 » → soldé, reste le relais/fermeture auto D3), and update the CLAUDE.md Active Workplan (In flight → S70 delivered; next session pointer).

- [ ] **Step 6: Commit + push**

```bash
git add docs/ CLAUDE.md
git commit -m "docs(s70): closeout — cashier variance report (INDEX, fiche 12 D2.4 ✅, CLAUDE.md)"
git push -u origin swarm/session-70
```

- [ ] **Step 7: Finish the branch** — invoke `superpowers:finishing-a-development-branch` to decide merge/PR (squash-merge to master per project convention).

---

## Self-Review

**Spec coverage:**
- RPC `get_cashier_variance_v1` (3 volets, opened_by, dow cash, tz, gate) → Task 1. ✅
- Frozen sources (cash column, qris/card from audit metadata, no recompute) → Task 1 SQL. ✅
- Types regen + graft fallback → Task 2. ✅
- pgTAP (aggregation, opened_by incl. manager-close, tz edge, audit sourcing incl. pre-S67 null, date filter, gate anon + no-perm) → Task 3. ✅
- BO hook → Task 4; page + dow matrix + CSV-only + route + sidebar + tile, all `reports.read` → Task 5; smoke → Task 6. ✅
- Empty state, `—` for uncounted volets, colored variance tokens → Task 5. ✅
- Money-path untouched proof (`s44_money_gates`) → Task 7 Step 3. ✅
- Out-of-scope (PDF, dow qris/card, drill-down, alerts, materialized columns) → not planned. ✅

**Placeholder scan:** RPC SQL, hook, page, CSV columns, route/sidebar/tile snippets are complete. The pgTAP seed INSERTs and the smoke harness are described with concrete assertions + a named reference file to copy the boilerplate from (auth preamble / render harness) rather than reproduced verbatim — acceptable because that boilerplate is project-idiomatic and must match the reference exactly. Icon names in Task 5 carry an explicit "use an already-imported icon" guard.

**Type consistency:** `get_cashier_variance_v1(p_start_date, p_end_date)` and the JSONB shape are identical across Task 1 (SQL), Task 2 (types), Task 4 (hook interfaces), Task 5 (page consumption). `CashierVarianceRow.cash.total_short`, `.dow_cash[].dow`, `.qris.counted_sessions` names match between hook and page. ✅
