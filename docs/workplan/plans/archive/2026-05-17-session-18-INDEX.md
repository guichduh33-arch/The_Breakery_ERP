# Session 18 — INDEX (Recipe Cost History Report)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-05-17
**Branch:** `swarm/session-18` (off `4803429` master, post-S17 note-merge)
**Spec:** [`../specs/2026-05-17-session-18-spec.md`](../../specs/archive/2026-05-17-session-18-spec.md)
**Migration block reserved:** `20260522000001..099`

---

## 1. Goal global

Expose S15-S17's append-only `recipe_versions` history through 2 BackOffice Reports pages : an overview table across all recipe-products and a single-recipe drill-down with chart + version table. Resolves the "S17 snapshots have no consumer" gap.

**Total phases exécutables : 5** (Wave 0..4).
**Effort estimé : ~10h parallel, ~12h solo.**

---

## 2. Architecture en vagues

```
Wave 0 (planning) — Phase 0.1
  └─► Spec + INDEX + branch + commit
        │
        ▼
Wave 1 (DB — solo) — Phase 1.A
  └─► recipe_cost_history_v1 RPC + pgTAP + Vitest
        │
        ▼ Wave 1 sync gate
Wave 2 (UI — 3 phases, 2.A + 2.B parallel, 2.C sequential)
  ├── Phase 2.A : RecipeCostOverviewPage
  ├── Phase 2.B : RecipeCostTimelinePage
  └── Phase 2.C : routes + Sidebar + ReportsIndex tile (after 2.A + 2.B done)
        │
        ▼ Wave 2 sync gate
Wave 3 — Phase 3.A : reviewer pass + types regen
        │
        ▼
Wave 4 — Phase 4.A : tests + build + CLAUDE.md + PR
```

---

## 3. Wave 0 — Prerequisites

### Phase 0.1 — Spec + INDEX + branch

**Files :**
- `docs/workplan/specs/2026-05-17-session-18-spec.md` ✓
- `docs/workplan/plans/2026-05-17-session-18-INDEX.md` ✓ (this doc)

**Steps :**
- [x] Spec dated, 14 decisions D1-D14
- [x] INDEX dated, 4 waves
- [ ] Branch `swarm/session-18` created off `4803429`
- [ ] Wave 0 commit on branch

**Complexity** : **S** (~1.5h).
**Suggested executor** : lead.

---

## 4. Wave 1 — DB

### Phase 1.A — recipe_cost_history_v1 RPC + tests

**Module(s)** : 14 (Reports), 15 (Production peripheral).

**Files :**
- `supabase/migrations/20260522000010_create_recipe_cost_history_v1_rpc.sql` (CREATE)
- `supabase/tests/recipe_cost_history_v1.test.sql` (CREATE)
- `supabase/tests/functions/recipe-cost-history.test.ts` (CREATE)

- [ ] **Step 1 — Create migration `20260522000010`**

Apply via MCP `apply_migration` (project_id=ikcyvlovptebroadgtvd, name=`create_recipe_cost_history_v1_rpc`). SQL body :

```sql
-- 20260522000010_create_recipe_cost_history_v1_rpc.sql
-- Session 18 / Phase 1.A — Recipe cost history report RPC.
--
-- Dual-mode (D1) :
--   p_product_id IS NULL     → overview (1 row per product with history)
--   p_product_id IS NOT NULL → drill-down (1 row per version in window)
--
-- Reads recipe_versions + products. Ignores legacy bare-array snapshots
-- (snapshot ? 'items' = false) per D4.
-- Gated by financial.read (D2) — same as ProfitLoss/BalanceSheet/CashFlow.

CREATE OR REPLACE FUNCTION recipe_cost_history_v1(
  p_from       DATE,
  p_to         DATE,
  p_product_id UUID DEFAULT NULL
) RETURNS TABLE(
  product_id        UUID,
  product_name      TEXT,
  version_number    INT,
  created_at        TIMESTAMPTZ,
  cost_per_unit     NUMERIC,
  change_note       TEXT,
  baseline_cost     NUMERIC,
  delta_pct         NUMERIC,
  change_count      INT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF NOT has_permission(v_uid, 'financial.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'date_range_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_from > p_to THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'P0001';
  END IF;

  IF p_product_id IS NOT NULL THEN
    -- Drill-down mode : chronological versions for one product in window.
    RETURN QUERY
    SELECT
      rv.product_id,
      p.name                                                AS product_name,
      rv.version_number,
      rv.created_at,
      (rv.snapshot->>'product_cost_at_version')::NUMERIC    AS cost_per_unit,
      rv.change_note,
      NULL::NUMERIC                                         AS baseline_cost,
      NULL::NUMERIC                                         AS delta_pct,
      NULL::INT                                             AS change_count
    FROM recipe_versions rv
    JOIN products p ON p.id = rv.product_id
    WHERE rv.product_id = p_product_id
      AND rv.snapshot ? 'items'
      AND rv.created_at::DATE BETWEEN p_from AND p_to
    ORDER BY rv.version_number ASC;
  ELSE
    -- Overview mode : 1 row per product, baseline (≤ p_from) vs current (≤ p_to).
    RETURN QUERY
    WITH products_with_history AS (
      SELECT DISTINCT rv.product_id
        FROM recipe_versions rv
       WHERE rv.snapshot ? 'items'
    ),
    baseline AS (
      SELECT pwh.product_id,
             (
               SELECT (rv.snapshot->>'product_cost_at_version')::NUMERIC
                 FROM recipe_versions rv
                WHERE rv.product_id = pwh.product_id
                  AND rv.snapshot ? 'items'
                  AND rv.created_at::DATE <= p_from
                ORDER BY rv.created_at DESC, rv.version_number DESC
                LIMIT 1
             ) AS cost
        FROM products_with_history pwh
    ),
    current_cost AS (
      SELECT pwh.product_id,
             (
               SELECT (rv.snapshot->>'product_cost_at_version')::NUMERIC
                 FROM recipe_versions rv
                WHERE rv.product_id = pwh.product_id
                  AND rv.snapshot ? 'items'
                  AND rv.created_at::DATE <= p_to
                ORDER BY rv.created_at DESC, rv.version_number DESC
                LIMIT 1
             ) AS cost
        FROM products_with_history pwh
    ),
    window_stats AS (
      SELECT rv.product_id,
             COUNT(*)::INT      AS cnt,
             MAX(rv.created_at) AS last_change
        FROM recipe_versions rv
       WHERE rv.snapshot ? 'items'
         AND rv.created_at::DATE BETWEEN p_from AND p_to
       GROUP BY rv.product_id
    )
    SELECT
      pwh.product_id,
      p.name                                                  AS product_name,
      NULL::INT                                               AS version_number,
      ws.last_change                                          AS created_at,
      cc.cost                                                 AS cost_per_unit,
      NULL::TEXT                                              AS change_note,
      b.cost                                                  AS baseline_cost,
      CASE
        WHEN b.cost IS NULL OR b.cost = 0 THEN NULL
        ELSE round(((cc.cost - b.cost) / b.cost) * 100, 2)
      END                                                     AS delta_pct,
      COALESCE(ws.cnt, 0)                                     AS change_count
    FROM products_with_history pwh
    JOIN products p ON p.id = pwh.product_id
    LEFT JOIN baseline b      ON b.product_id = pwh.product_id
    LEFT JOIN current_cost cc ON cc.product_id = pwh.product_id
    LEFT JOIN window_stats ws ON ws.product_id = pwh.product_id
    WHERE ws.cnt IS NOT NULL OR b.cost IS NOT NULL
    ORDER BY p.name;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION recipe_cost_history_v1(DATE, DATE, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION recipe_cost_history_v1(DATE, DATE, UUID) FROM anon;

COMMENT ON FUNCTION recipe_cost_history_v1(DATE, DATE, UUID) IS
  'Session 18 / Phase 1.A. Recipe cost history report. Dual-mode : overview '
  '(p_product_id NULL) or drill-down (p_product_id set). Gated by financial.read. '
  'Ignores legacy bare-array snapshots.';
```

- [ ] **Step 2 — Verify migration applied**

```
mcp__plugin_supabase_supabase__execute_sql
  project_id: ikcyvlovptebroadgtvd
  query: SELECT proname FROM pg_proc WHERE proname = 'recipe_cost_history_v1';
```

Expected : 1 row.

- [ ] **Step 3 — Write pgTAP test**

Create `supabase/tests/recipe_cost_history_v1.test.sql`. Use in-transaction fixture pattern (same as S17 tests). At minimum 10 assertions :

```sql
-- supabase/tests/recipe_cost_history_v1.test.sql
-- Session 18 — Phase 1.A — pgTAP for recipe_cost_history_v1.

BEGIN;
SELECT plan(10);

-- Fixture in DO block : insert 1 product, 3 versions at different dates.
-- Use SET LOCAL ROLE postgres for setup (bypass RLS), then test in postgres
-- context (financial.read implicit). For permission test (T9), use SET LOCAL
-- ROLE anon and EXPECT P0003.

DO $$
DECLARE
  v_prod UUID;
BEGIN
  -- Create product (use generated UUID, fixture stays isolated).
  INSERT INTO products(name, unit, cost_price)
    VALUES ('S18 Cost History Test', 'pcs', 100.00)
    RETURNING id INTO v_prod;

  -- Insert 3 recipe_versions manually (bypass triggers — direct DB writes
  -- via postgres role for fixture predictability).
  INSERT INTO recipe_versions(product_id, version_number, snapshot, change_note, created_at)
  VALUES
    (v_prod, 1,
     jsonb_build_object('items', '[]'::jsonb, 'product_cost_at_version', 100.00),
     'insert',  now() - interval '30 days'),
    (v_prod, 2,
     jsonb_build_object('items', '[]'::jsonb, 'product_cost_at_version', 120.00),
     'update', now() - interval '15 days'),
    (v_prod, 3,
     jsonb_build_object('items', '[]'::jsonb, 'product_cost_at_version', 150.00),
     'material price update: leaf 100→125', now() - interval '5 days');

  PERFORM set_config('test.product_id', v_prod::text, FALSE);
END $$;

-- T1 : Overview returns one row for the test product.
SELECT is(
  (SELECT count(*) FROM recipe_cost_history_v1(
     (now() - interval '40 days')::DATE,
     now()::DATE,
     NULL)
    WHERE product_id = current_setting('test.product_id')::UUID),
  1::bigint,
  'overview: 1 row per product with history in window'
);

-- T2 : Overview baseline_cost matches version 1 (created 30d ago, baseline
-- pulled from <= p_from window).
SELECT is(
  (SELECT baseline_cost FROM recipe_cost_history_v1(
     (now() - interval '20 days')::DATE,  -- p_from = 20d ago, baseline is v1 (30d ago, 100.00)
     now()::DATE,
     NULL)
    WHERE product_id = current_setting('test.product_id')::UUID),
  100.00::NUMERIC,
  'overview: baseline = latest version ≤ p_from'
);

-- T3 : Overview current_cost = latest in [p_from, p_to] = v3 cost 150.
SELECT is(
  (SELECT cost_per_unit FROM recipe_cost_history_v1(
     (now() - interval '20 days')::DATE,
     now()::DATE,
     NULL)
    WHERE product_id = current_setting('test.product_id')::UUID),
  150.00::NUMERIC,
  'overview: current = latest version ≤ p_to'
);

-- T4 : Overview delta_pct = (150-100)/100 × 100 = 50.00.
SELECT is(
  (SELECT delta_pct FROM recipe_cost_history_v1(
     (now() - interval '20 days')::DATE,
     now()::DATE,
     NULL)
    WHERE product_id = current_setting('test.product_id')::UUID),
  50.00::NUMERIC,
  'overview: delta_pct = (current-baseline)/baseline*100'
);

-- T5 : Overview change_count = 2 (v2 + v3 in window 20d→now).
SELECT is(
  (SELECT change_count FROM recipe_cost_history_v1(
     (now() - interval '20 days')::DATE,
     now()::DATE,
     NULL)
    WHERE product_id = current_setting('test.product_id')::UUID),
  2::INT,
  'overview: change_count = versions in [p_from, p_to]'
);

-- T6 : Drill-down returns 2 versions in window 20d→now (v2 + v3).
SELECT is(
  (SELECT count(*) FROM recipe_cost_history_v1(
     (now() - interval '20 days')::DATE,
     now()::DATE,
     current_setting('test.product_id')::UUID)),
  2::bigint,
  'drill-down: returns versions in window for given product'
);

-- T7 : Drill-down ORDER BY version_number ASC (first row = v2).
SELECT is(
  (SELECT version_number FROM recipe_cost_history_v1(
     (now() - interval '20 days')::DATE,
     now()::DATE,
     current_setting('test.product_id')::UUID)
   ORDER BY version_number ASC LIMIT 1),
  2::INT,
  'drill-down: ASC sort by version_number'
);

-- T8 : Empty window returns zero rows.
SELECT is(
  (SELECT count(*) FROM recipe_cost_history_v1(
     '2025-01-01'::DATE,
     '2025-01-02'::DATE,
     NULL)
    WHERE product_id = current_setting('test.product_id')::UUID),
  0::bigint,
  'overview: empty window returns 0 rows'
);

-- T9 : p_from > p_to raises P0001 invalid_date_range.
SELECT throws_ok(
  $$ SELECT * FROM recipe_cost_history_v1('2026-12-31'::DATE, '2026-01-01'::DATE, NULL) $$,
  'P0001',
  'invalid_date_range',
  'invalid date range raises P0001'
);

-- T10 : Drill-down on unknown product_id returns 0 rows (no error).
SELECT is(
  (SELECT count(*) FROM recipe_cost_history_v1(
     (now() - interval '40 days')::DATE,
     now()::DATE,
     gen_random_uuid())),
  0::bigint,
  'drill-down: unknown product_id returns 0 rows, no error'
);

SELECT * FROM finish();
ROLLBACK;
```

Run via MCP `execute_sql` (BEGIN/ROLLBACK envelope). All 10 must pass.

- [ ] **Step 4 — Write Vitest live smoke**

Look at `supabase/tests/functions/recipe-bom-full.test.ts` (S17) for the PIN client pattern. Mirror :

```ts
// supabase/tests/functions/recipe-cost-history.test.ts
// Session 18 — Phase 1.A — Vitest live smoke for recipe_cost_history_v1.

import { describe, it, expect } from 'vitest';
import { createPinClient } from './_helpers/pin-client.js';
// (Adjust import path to whatever S17 uses.)

const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_URL  = process.env.VITE_SUPABASE_URL;

describe.skipIf(!SUPABASE_ANON || !SUPABASE_URL)('recipe_cost_history_v1', () => {
  it('overview returns rows for seeded products', async () => {
    const supabase = await createPinClient('1234');
    const from = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    const to   = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase.rpc('recipe_cost_history_v1', {
      p_from: from, p_to: to, p_product_id: null,
    });
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    if (data!.length > 0) {
      const row = data![0];
      expect(row).toMatchObject({
        product_id: expect.any(String),
        product_name: expect.any(String),
        change_count: expect.any(Number),
      });
    }
  });

  it('drill-down respects p_product_id', async () => {
    const supabase = await createPinClient('1234');
    const from = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    const to   = new Date().toISOString().slice(0, 10);
    // Use a known seeded product id if available ; else gen_random_uuid for empty check.
    const { data, error } = await supabase.rpc('recipe_cost_history_v1', {
      p_from: from, p_to: to,
      p_product_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
```

- [ ] **Step 5 — Commit**

```bash
git add supabase/migrations/20260522000010_create_recipe_cost_history_v1_rpc.sql \
        supabase/tests/recipe_cost_history_v1.test.sql \
        supabase/tests/functions/recipe-cost-history.test.ts
git commit -m "$(cat <<'EOF'
feat(reports): session 18 — phase 1.A — recipe_cost_history_v1 RPC

New RPC for the Recipe Cost History Report. Dual-mode :
- p_product_id NULL → overview (1 row per product with cost history,
  baseline ≤ p_from vs current ≤ p_to, delta_pct, change_count).
- p_product_id set → drill-down (1 row per version in window, chronological).

D2 : gated by financial.read (same as ProfitLoss/BalanceSheet).
D4 : legacy bare-array snapshots excluded (consistent with DEV-S16-2.B-02).

pgTAP coverage : 10 assertions (overview math, drill-down sort, empty
window, invalid_date_range, permission gate, unknown product handling).
Vitest live smoke against V3 dev.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**DoD :**
- [ ] `recipe_cost_history_v1(DATE, DATE, UUID)` exists with documented signature.
- [ ] Overview math : baseline + current + delta_pct + change_count correct.
- [ ] Drill-down : chronological sort, product_id filter, unknown id → 0 rows.
- [ ] Empty window returns 0 rows ; invalid_date_range raises P0001 ; missing perms raises P0003.
- [ ] Legacy bare-array snapshots excluded.
- [ ] 10+ pgTAP assertions green.
- [ ] Commit on `swarm/session-18`.

**Complexity** : **M** (~4h).
**Dependencies** : Wave 0.
**Suggested executor** : `cost-history-rpc-arch` (backend-dev + DB SQL).
**Parallelization tag** : solo Wave 1.

---

## 5. Wave 2 — UI

### Phase 2.A — RecipeCostOverviewPage (parallel with 2.B)

**Files :**
- `apps/backoffice/src/pages/reports/RecipeCostOverviewPage.tsx` (CREATE)
- `apps/backoffice/src/pages/reports/__tests__/RecipeCostOverviewPage.smoke.test.tsx` (CREATE)

**Pattern source** : `apps/backoffice/src/pages/reports/ProductionYieldPage.tsx`.

- [ ] **Step 1 — Read pattern source**

Read `apps/backoffice/src/pages/reports/ProductionYieldPage.tsx` in full to understand the layout/CSV/DateRangePicker/varianceTone idioms. This is the closest analog — copy its shape.

- [ ] **Step 2 — Implement page**

Create the file with the following shape (adapt to match `ProductionYieldPage` style verbatim — same imports, same helpers, same CSV builder pattern) :

```tsx
// apps/backoffice/src/pages/reports/RecipeCostOverviewPage.tsx
// Session 18 — Phase 2.A — Cross-recipe cost overview.

import { useMemo, useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toLocalDateStr } from '@breakery/domain';
import { Button } from '@breakery/ui';
import { supabase } from '@/lib/supabase.js';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';

interface OverviewRow {
  product_id:        string;
  product_name:      string;
  cost_per_unit:     number | null;   // current cost (≤ p_to)
  baseline_cost:     number | null;   // cost ≤ p_from
  delta_pct:         number | null;
  change_count:      number;
  created_at:        string | null;   // last_change_date in overview mode
}

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000));
}

function deltaTone(d: number | null): string {
  if (d === null) return 'text-text-secondary';
  const abs = Math.abs(d);
  if (abs > 20) return 'text-red-600 font-semibold';
  if (abs > 5)  return 'text-amber-600';
  return 'text-emerald-600';
}

function formatDelta(d: number | null): string {
  if (d === null) return '—';
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toFixed(2)}%`;
}

function csvCell(v: string | number | null): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowsToCsv(rows: OverviewRow[]): string {
  const header = ['product_name','current_cost','baseline_cost','delta_pct','change_count','last_change_date'].join(',');
  const body = rows.map(r => [
    csvCell(r.product_name),
    csvCell(r.cost_per_unit),
    csvCell(r.baseline_cost),
    csvCell(r.delta_pct === null ? null : r.delta_pct.toFixed(2)),
    csvCell(r.change_count),
    csvCell(r.created_at ?? ''),
  ].join(','));
  return [header, ...body].join('\n');
}

export function RecipeCostOverviewPage(): JSX.Element {
  const navigate = useNavigate();
  const [from, setFrom] = useState<string>(defaultStart());
  const [to,   setTo]   = useState<string>(toLocalDateStr(new Date()));

  const q = useQuery<OverviewRow[]>({
    queryKey: ['reports', 'recipe-cost', 'overview', from, to] as const,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('recipe_cost_history_v1', {
        p_from: from, p_to: to, p_product_id: null,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as OverviewRow[];
    },
  });

  const rows = useMemo<OverviewRow[]>(() => {
    const list = q.data ?? [];
    return [...list].sort((a, b) => {
      const da = a.delta_pct === null ? -Infinity : Math.abs(a.delta_pct);
      const db = b.delta_pct === null ? -Infinity : Math.abs(b.delta_pct);
      return db - da;
    });
  }, [q.data]);

  function handleCsv() {
    const csv = rowsToCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recipe-cost-overview-${from}_${to}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <ReportPage
      title="Recipe Cost Overview"
      subtitle="Delta in the selected window. Click a row for the full version timeline."
      filters={
        <>
          <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
          <Button variant="ghost" size="sm" onClick={handleCsv} disabled={rows.length === 0}>
            Export CSV
          </Button>
        </>
      }
    >
      {q.isLoading ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : q.error ? (
        <p role="alert" className="text-sm text-red-600">{(q.error as Error).message}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-secondary" data-testid="empty-overview">
          No recipe cost movement in the selected window.
        </p>
      ) : (
        <table className="w-full text-sm" data-testid="overview-table">
          <thead>
            <tr className="text-left text-xs uppercase tracking-widest text-text-secondary">
              <th className="py-1">Product</th>
              <th className="py-1 text-right">Current</th>
              <th className="py-1 text-right">Baseline</th>
              <th className="py-1 text-right">Δ %</th>
              <th className="py-1 text-right">Changes</th>
              <th className="py-1 text-right">Last change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr
                key={r.product_id}
                className="border-t border-border-subtle cursor-pointer hover:bg-bg-elevated"
                data-testid={`overview-row-${r.product_id}`}
                onClick={() => navigate(`/reports/recipe-cost/${r.product_id}`)}
              >
                <td className="py-1.5">{r.product_name}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {r.cost_per_unit?.toLocaleString('en-US', { maximumFractionDigits: 2 }) ?? '—'}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {r.baseline_cost?.toLocaleString('en-US', { maximumFractionDigits: 2 }) ?? '—'}
                </td>
                <td className={`py-1.5 text-right tabular-nums ${deltaTone(r.delta_pct)}`}>
                  {formatDelta(r.delta_pct)}
                </td>
                <td className="py-1.5 text-right tabular-nums">{r.change_count}</td>
                <td className="py-1.5 text-right tabular-nums text-text-secondary">
                  {r.created_at ? r.created_at.slice(0, 10) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ReportPage>
  );
}
```

- [ ] **Step 3 — Write smoke test**

Read `apps/backoffice/src/pages/reports/__tests__/SalesByHourPage.smoke.test.tsx` (or any S15 reports smoke) for the supabase RPC mock pattern. Create the test file with 5+ assertions :
- Empty state renders « No recipe cost movement … »
- Mock returns 2 rows → table renders 2 rows.
- delta_pct color tone : `+30 → red-600`, `+10 → amber-600`, `+2 → emerald-600`.
- Click on row navigates to `/reports/recipe-cost/<productId>` (mock `useNavigate`).
- CSV button disabled when no data, enabled with data (don't actually test download — mock URL.createObjectURL if needed).

- [ ] **Step 4 — Run tests**

```bash
pnpm --filter @breakery/app-backoffice test RecipeCostOverviewPage.smoke
```

Expected : green.

- [ ] **Step 5 — Commit**

```bash
git add apps/backoffice/src/pages/reports/RecipeCostOverviewPage.tsx \
        apps/backoffice/src/pages/reports/__tests__/RecipeCostOverviewPage.smoke.test.tsx
git commit -m "feat(reports): session 18 — phase 2.A — RecipeCostOverviewPage"
```

**DoD :**
- [ ] Page renders with DateRangePicker (default 30d), Export CSV, table.
- [ ] Sort by `|delta_pct|` DESC verified.
- [ ] Row click navigates to drill-down route.
- [ ] CSV emits correct header + row formatting.
- [ ] 5+ smoke assertions green.

**Complexity** : **M** (~3h).
**Dependencies** : Phase 1.A (RPC exists + types regenerated).
**Suggested executor** : `cost-overview-coder` (frontend).
**Parallelization tag** : parallel with 2.B after 1.A.

---

### Phase 2.B — RecipeCostTimelinePage (parallel with 2.A)

**Files :**
- `apps/backoffice/src/pages/reports/RecipeCostTimelinePage.tsx` (CREATE)
- `apps/backoffice/src/pages/reports/__tests__/RecipeCostTimelinePage.smoke.test.tsx` (CREATE)

**Pattern source** : `apps/backoffice/src/pages/reports/SalesByHourPage.tsx` (recharts LineChart) + `ProductionYieldPage` (DateRangePicker + CSV).

- [ ] **Step 1 — Read pattern sources**

Read both `SalesByHourPage.tsx` (chart) and `ProductionYieldPage.tsx` (DateRangePicker + CSV) to mirror their import + render style.

- [ ] **Step 2 — Implement page**

```tsx
// apps/backoffice/src/pages/reports/RecipeCostTimelinePage.tsx
// Session 18 — Phase 2.B — Single-recipe cost timeline with LineChart.

import { useMemo, useState, type JSX } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from 'recharts';
import { toLocalDateStr } from '@breakery/domain';
import { Button } from '@breakery/ui';
import { supabase } from '@/lib/supabase.js';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';

interface TimelineRow {
  product_id:     string;
  product_name:   string;
  version_number: number;
  created_at:     string;
  cost_per_unit:  number;
  change_note:    string | null;
}

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 89 * 86_400_000));
}

function deltaTone(d: number | null): string {
  if (d === null) return 'text-text-secondary';
  const abs = Math.abs(d);
  if (abs > 20) return 'text-red-600 font-semibold';
  if (abs > 5)  return 'text-amber-600';
  return 'text-emerald-600';
}

function csvCell(v: string | number | null): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function RecipeCostTimelinePage(): JSX.Element {
  const { productId = '' } = useParams<{ productId: string }>();
  const [from, setFrom] = useState<string>(defaultStart());
  const [to,   setTo]   = useState<string>(toLocalDateStr(new Date()));

  const q = useQuery<TimelineRow[]>({
    queryKey: ['reports', 'recipe-cost', 'timeline', productId, from, to] as const,
    enabled: productId !== '',
    queryFn: async () => {
      const { data, error } = await supabase.rpc('recipe_cost_history_v1', {
        p_from: from, p_to: to, p_product_id: productId,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as TimelineRow[];
    },
  });

  const rows = q.data ?? [];
  const productName = rows[0]?.product_name ?? 'Recipe Cost Timeline';

  // Compute delta vs prev row.
  const rowsWithDelta = useMemo(() => {
    return rows.map((r, i) => {
      const prev = rows[i - 1]?.cost_per_unit;
      const delta = (prev === undefined || prev === 0)
        ? null
        : round2(((r.cost_per_unit - prev) / prev) * 100);
      return { ...r, delta_pct: delta };
    });
  }, [rows]);

  const chartData = useMemo(() => rows.map(r => ({
    date: r.created_at.slice(0, 10),
    cost: r.cost_per_unit,
    note: r.change_note ?? '',
  })), [rows]);

  function handleCsv() {
    const safeName = productName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const header = ['version_number','created_at','cost_per_unit','delta_vs_prev_pct','change_note'].join(',');
    const body = rowsWithDelta.map(r => [
      csvCell(r.version_number),
      csvCell(r.created_at),
      csvCell(r.cost_per_unit),
      csvCell(r.delta_pct?.toFixed(2) ?? ''),
      csvCell(r.change_note ?? ''),
    ].join(','));
    const csv = [header, ...body].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recipe-cost-timeline-${safeName}-${from}_${to}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  if (productId === '') {
    return (
      <ReportPage title="Recipe Cost Timeline">
        <p className="text-sm text-text-secondary">Missing product id.</p>
      </ReportPage>
    );
  }

  return (
    <ReportPage
      title={productName}
      subtitle="Cost-per-unit history for this recipe."
      filters={
        <>
          <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
          <Button variant="ghost" size="sm" onClick={handleCsv} disabled={rows.length === 0}>
            Export CSV
          </Button>
        </>
      }
    >
      <div className="mb-4">
        <Link to="/reports/recipe-cost" className="text-xs text-text-secondary hover:underline">
          ← Recipe Cost Overview
        </Link>
      </div>

      {q.isLoading ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : q.error ? (
        <p role="alert" className="text-sm text-red-600">{(q.error as Error).message}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-secondary" data-testid="empty-timeline">
          No cost history for this product in the selected window.
        </p>
      ) : (
        <>
          <div data-testid="timeline-chart" style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="cost" stroke="#d4a437" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <table className="w-full text-sm mt-6" data-testid="timeline-table">
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest text-text-secondary">
                <th className="py-1">Version</th>
                <th className="py-1">Date</th>
                <th className="py-1 text-right">Cost</th>
                <th className="py-1 text-right">Δ vs prev</th>
                <th className="py-1">Change note</th>
              </tr>
            </thead>
            <tbody>
              {rowsWithDelta.map(r => (
                <tr key={`${r.product_id}-${r.version_number}`} className="border-t border-border-subtle">
                  <td className="py-1.5 tabular-nums">v{r.version_number}</td>
                  <td className="py-1.5 tabular-nums text-text-secondary">{r.created_at.slice(0, 19).replace('T', ' ')}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {r.cost_per_unit.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                  </td>
                  <td className={`py-1.5 text-right tabular-nums ${deltaTone(r.delta_pct)}`}>
                    {r.delta_pct === null ? '—' : (r.delta_pct > 0 ? '+' : '') + r.delta_pct.toFixed(2) + '%'}
                  </td>
                  <td className="py-1.5 text-text-secondary">{r.change_note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </ReportPage>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
```

- [ ] **Step 3 — Write smoke test**

5+ assertions. Mock supabase RPC. Mock recharts to render a `<div data-testid="timeline-chart">` (recharts is hard to test ; check by `data-testid` only, not chart internals).
- Empty state when 0 rows.
- 3 rows → table has 3 rows, first row delta = `—`, subsequent rows have computed deltas.
- Chart wrapper renders (via `data-testid="timeline-chart"`).
- CSV button disabled when empty, enabled with data.
- Back link to `/reports/recipe-cost`.

- [ ] **Step 4 — Run tests**

```bash
pnpm --filter @breakery/app-backoffice test RecipeCostTimelinePage.smoke
```

- [ ] **Step 5 — Commit**

```bash
git add apps/backoffice/src/pages/reports/RecipeCostTimelinePage.tsx \
        apps/backoffice/src/pages/reports/__tests__/RecipeCostTimelinePage.smoke.test.tsx
git commit -m "feat(reports): session 18 — phase 2.B — RecipeCostTimelinePage"
```

**DoD :**
- [ ] Page renders chart + table for a product with cost history.
- [ ] Delta vs prev computed client-side, first row = `—`.
- [ ] Empty state when zero versions in window.
- [ ] CSV export works.
- [ ] Back link to overview.
- [ ] 5+ smoke assertions green.

**Complexity** : **M** (~3h).
**Dependencies** : Phase 1.A.
**Suggested executor** : `cost-timeline-coder` (frontend + recharts).
**Parallelization tag** : parallel with 2.A.

---

### Phase 2.C — Wiring (routes + Sidebar + ReportsIndex)

**Files :**
- `apps/backoffice/src/routes/index.tsx` (or wherever router is — UPDATE)
- `apps/backoffice/src/layouts/Sidebar.tsx` (UPDATE)
- `apps/backoffice/src/pages/reports/ReportsIndexPage.tsx` (UPDATE)

- [ ] **Step 1 — Add routes**

Read the router file (likely `apps/backoffice/src/routes/index.tsx` ; grep for existing report routes like `'reports/profit-loss'` to find the right place). Add :

```tsx
{
  path: '/reports/recipe-cost',
  element: <RecipeCostOverviewPage />,
  // Same permission gate wrapper as the other reports (financial.read).
},
{
  path: '/reports/recipe-cost/:productId',
  element: <RecipeCostTimelinePage />,
},
```

Import the two pages.

- [ ] **Step 2 — Add Sidebar entry**

Read `apps/backoffice/src/layouts/Sidebar.tsx`. Find the Reports section / nav items. Add « Recipe Cost » entry pointing to `/reports/recipe-cost`. Match the existing styling/permission gating used by other report entries.

- [ ] **Step 3 — Add ReportsIndex tile**

Read `apps/backoffice/src/pages/reports/ReportsIndexPage.tsx`. Find the tile grid. Add a new tile :
- Title : « Recipe Cost »
- Subtitle / description : « History of per-recipe unit cost. »
- Link : `/reports/recipe-cost`
- Match existing tile pattern.

- [ ] **Step 4 — Smoke verify**

```bash
pnpm --filter @breakery/app-backoffice test ReportsIndexPage.smoke
pnpm typecheck
```

The ReportsIndexPage smoke test may need an additional assertion for the new tile — add one if the test enumerates expected tiles.

- [ ] **Step 5 — Commit**

```bash
git add apps/backoffice/src/routes/index.tsx \
        apps/backoffice/src/layouts/Sidebar.tsx \
        apps/backoffice/src/pages/reports/ReportsIndexPage.tsx \
        apps/backoffice/src/pages/reports/__tests__/ReportsIndexPage.smoke.test.tsx
git commit -m "feat(reports): session 18 — phase 2.C — wire recipe cost report (routes + sidebar + tile)"
```

**DoD :**
- [ ] 2 routes wired (overview + drill-down with :productId param).
- [ ] Sidebar « Recipe Cost » entry visible.
- [ ] ReportsIndex tile present.
- [ ] `pnpm typecheck` green.
- [ ] No regressions in existing reports smoke tests.

**Complexity** : **S** (~1.5h).
**Dependencies** : Phase 2.A + 2.B.
**Suggested executor** : `cost-wiring-coder` (frontend).

---

## 6. Wave 3 — Gate

### Phase 3.A — Reviewer pass + types regen

**Steps :**
- [ ] MCP `generate_typescript_types` → write `packages/supabase/src/types.generated.ts`.
- [ ] Verify `recipe_cost_history_v1` signature visible.
- [ ] `pnpm typecheck` green.
- [ ] Run pgTAP suites via MCP execute_sql :
  - `recipe_cost_history_v1.test.sql` (10 tests)
  - S17 regression : `recipe_cascade_snapshot.test.sql` (28), `recipe_bom_full_v1.test.sql` (10)
- [ ] Reviewer agent : spec coverage + cross-page touchpoints (no regressions in existing reports pages, no incidental breakage of recipe_versions consumers).

**Complexity** : **S** (~1h).

---

## 7. Wave 4 — Closeout

### Phase 4.A — Tests + build + CLAUDE.md + PR

- [ ] `pnpm typecheck` green.
- [ ] `pnpm exec turbo run test --concurrency=1` green (modulo S13-S15 pre-existing flakes).
- [ ] `pnpm build` green.
- [ ] Update CLAUDE.md « Active Workplan » :
  - Promote S18 → previous session, S19 → current TBD.
  - Move S17 to reference rank.
  - List S18 follow-ups (DEV-S18-1.A-01, 2.A-01/02, 2.B-01/02).
- [ ] PR draft « Session 18 — Recipe Cost History Report » → master with body listing RPC + 2 pages + wiring + test coverage.
- [ ] Push branch + create PR via `gh pr create`.
- [ ] Return PR URL.

**Complexity** : **S** (~1.5h).

---

## 8. Parallelization map

| Wave | Phases | Parallel streams | Estim h |
|---|---|---|---|
| 0 | 0.1 | sequential | 1.5 |
| 1 | 1.A | solo | 4 |
| 2 | 2.A + 2.B parallel ; 2.C sequential | 2 parallel + 1 seq | max(3,3) + 1.5 = 4.5 |
| 3 | 3.A | gate | 1 |
| 4 | 4.A | sequential | 1.5 |
| **TOTAL** | **5** | **4 waves** | **~12.5h** (full parallel-optimized) |

---

## 9. Comms entre subagents

```
lead (Claude) ←→ cost-history-rpc-arch (Phase 1.A — solo)
              ←→ cost-overview-coder   (Phase 2.A, parallel with 2.B)
              ←→ cost-timeline-coder   (Phase 2.B, parallel with 2.A)
              ←→ cost-wiring-coder     (Phase 2.C, after 2.A+2.B)
              ←→ reviewer              (Phase 3.A gate)
```

---

## 10. Deviation packs (Session 18 → Session 19+)

*Filled during execution. Anticipated buckets :*

| ID (anticipated) | Phase | Severity | Surface |
|---|---|---|---|
| `DEV-S18-1.A-01` | 1.A | informational | RPC scans all `recipe_versions` per call ; no index on `(product_id, created_at DESC)`. |
| `DEV-S18-2.A-01` | 2.A | informational | Overview baseline lookup uses N+1 subqueries via LATERAL. Window function rewrite deferred. |
| `DEV-S18-2.A-02` | 2.A | informational | CSV exports raw NUMERIC ; no locale formatting. |
| `DEV-S18-2.B-01` | 2.B | informational | Timeline chart X axis = raw ISO dates ; no locale formatting. |
| `DEV-S18-2.B-02` | 2.B | informational | No zoom interaction on chart. |

---

## 11. Out of scope (déféré Session 19+)

- Allergen module on receipt + customer display (DEV-S15-5.C-01) — wontfix per user 2026-05-17.
- DEV-S16-2.A-01 trigram predicate fix.
- DEV-S16-1.A-01 PR-time pgTAP gate.
- Session 13 deferred items (Playwright CI, pg_net birthday cron, Cash Flow IF/Financing, mv_pl_monthly reuse, staging-deploy secrets).
- DEV-S17-3.A-01 backoffice smoke flakes stabilization.
- Cost forecasting / what-if scenarios.
- PDF export.

---

*INDEX écrit 2026-05-17 sur `master` par lead. Spec : [`../specs/2026-05-17-session-18-spec.md`](../../specs/archive/2026-05-17-session-18-spec.md).*
