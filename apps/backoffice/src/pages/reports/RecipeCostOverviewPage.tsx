// apps/backoffice/src/pages/reports/RecipeCostOverviewPage.tsx
// Session 18 — Phase 2.A — Cross-recipe cost overview.
//
// Consumes recipe_cost_history_v1(p_from, p_to, p_product_id: null) in overview
// mode. Lists every product with cost history, sorted by |delta_pct| DESC.
// Row click navigates to the timeline drill-down (Phase 2.B).
//
// Pattern source: ProductionYieldPage (S15) — same ReportPage + DateRangePicker
// + CSV idioms.

import { useMemo, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toLocalDateStr, buildCsv, downloadCsv, type CsvColumn } from '@breakery/domain';
import { Button } from '@breakery/ui';
import { supabase } from '@/lib/supabase.js';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { useUrlState } from '@/hooks/useUrlState.js';

interface OverviewRow {
  product_id:    string;
  product_name:  string;
  cost_per_unit: number | null; // current cost (≤ p_to)
  baseline_cost: number | null;
  delta_pct:     number | null;
  change_count:  number;
  created_at:    string | null; // last_change_date in overview mode
}

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000));
}

/** Delta tone — thresholds are percentage points (not fractions). */
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

const OVERVIEW_CSV_COLUMNS: CsvColumn<OverviewRow>[] = [
  { header: 'product_name',   accessor: (r) => r.product_name },
  { header: 'current_cost',   accessor: (r) => r.cost_per_unit },
  { header: 'baseline_cost',  accessor: (r) => r.baseline_cost },
  { header: 'delta_pct',      accessor: (r) => r.delta_pct === null ? null : r.delta_pct.toFixed(2) },
  { header: 'change_count',   accessor: (r) => r.change_count },
  { header: 'last_change_date', accessor: (r) => r.created_at ?? '' },
];

export function RecipeCostOverviewPage(): JSX.Element {
  const navigate = useNavigate();
  const [start, setStart] = useUrlState('start', defaultStart());
  const [end,   setEnd]   = useUrlState('end', toLocalDateStr(new Date()));

  const q = useQuery<OverviewRow[]>({
    queryKey: ['reports', 'recipe-cost', 'overview', start, end] as const,
    staleTime: 60_000,
    queryFn: async (): Promise<OverviewRow[]> => {
      const { data, error } = await supabase.rpc('recipe_cost_history_v1', {
        p_from: start,
        p_to: end,
        // omit p_product_id → PostgreSQL DEFAULT NULL → overview mode
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as OverviewRow[];
    },
  });

  /** Sort by |delta_pct| DESC (D7). Non-null deltas first; NULLs last. */
  const rows = useMemo<OverviewRow[]>(() => {
    const list = q.data ?? [];
    return [...list].sort((a, b) => {
      const da = a.delta_pct === null ? -Infinity : Math.abs(a.delta_pct);
      const db = b.delta_pct === null ? -Infinity : Math.abs(b.delta_pct);
      return db - da;
    });
  }, [q.data]);

  function handleExportCsv(): void {
    const csv = buildCsv(rows, OVERVIEW_CSV_COLUMNS);
    downloadCsv(csv, `recipe-cost-overview-${start}_${end}.csv`);
  }

  return (
    <ReportPage
      title="Recipe Cost Overview"
      subtitle="Delta in the selected window. Click a row for the full version timeline."
      isEmpty={!q.isLoading && !q.error && rows.length === 0}
      emptyState={{
        title: 'No cost movement',
        description: 'No recipe cost movement in the selected window.',
        'data-testid': 'empty-overview',
      }}
      filters={
        <>
          <DateRangePicker
            start={start}
            end={end}
            onStartChange={setStart}
            onEndChange={setEnd}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleExportCsv}
            disabled={rows.length === 0}
            data-testid="overview-export-csv"
          >
            Export CSV
          </Button>
        </>
      }
    >
      {q.isLoading && (
        <p className="text-sm text-text-secondary">Loading…</p>
      )}
      {q.error && (
        <p role="alert" className="text-sm text-red-600">
          {(q.error as Error).message}
        </p>
      )}
      {rows.length > 0 && (
        <table className="w-full text-sm" data-testid="overview-table">
          <thead>
            <tr className="text-left text-xs uppercase tracking-widest text-text-secondary border-b border-border-subtle">
              <th className="py-2">Product</th>
              <th className="py-2 text-right">Current</th>
              <th className="py-2 text-right">Baseline</th>
              <th className="py-2 text-right">Δ %</th>
              <th className="py-2 text-right">Changes</th>
              <th className="py-2 text-right">Last change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.product_id}
                className="border-t border-border-subtle cursor-pointer hover:bg-bg-elevated"
                data-testid={`overview-row-${r.product_id}`}
                onClick={() => navigate(`/backoffice/reports/recipe-cost/${r.product_id}`)}
              >
                <td className="py-1.5" onClick={(e) => e.stopPropagation()}>
                  <DrilldownLink entity="recipe" id={r.product_id} label={r.product_name} icon={false} />
                </td>
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

export default RecipeCostOverviewPage;
