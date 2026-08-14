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
import { toLocalDateStr, type CsvColumn } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import { useUrlState } from '@/hooks/useUrlState.js';
import { formatIdrPrecise } from '@/features/reports/utils/chartColors.js';
import {
  useRecipeCostOverview, type RecipeCostOverviewRow as OverviewRow,
} from '@/features/reports/hooks/useRecipeCostHistory.js';

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000));
}

/** Delta tone — thresholds are percentage points (not fractions). */
function deltaTone(d: number | null): string {
  if (d === null) return 'text-text-secondary';
  const abs = Math.abs(d);
  if (abs > 20) return 'text-danger font-semibold';
  if (abs > 5)  return 'text-warning';
  return 'text-success';
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

  const q = useRecipeCostOverview(start, end);

  /** Sort by |delta_pct| DESC (D7). Non-null deltas first; NULLs last. */
  const rows = useMemo<OverviewRow[]>(() => {
    const list = q.data ?? [];
    return [...list].sort((a, b) => {
      const da = a.delta_pct === null ? -Infinity : Math.abs(a.delta_pct);
      const db = b.delta_pct === null ? -Infinity : Math.abs(b.delta_pct);
      return db - da;
    });
  }, [q.data]);

  // Audit R-13 — le template PDF `recipe_overview` etait construit mais
  // inatteignable : la page n'exposait qu'un CSV maison.
  const pdfRows = useMemo(() => rows.map((r) => ({
    product_name:  r.product_name,
    cost_per_unit: r.cost_per_unit ?? 0,
    baseline_cost: r.baseline_cost,
    delta_pct:     r.delta_pct,
    change_count:  r.change_count,
    created_at:    r.created_at,
  })), [rows]);

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
          {rows.length > 0 && (
            <ExportButtons
              csv={{ rows, columns: OVERVIEW_CSV_COLUMNS, filename: `recipe-cost-overview-${start}_${end}` }}
              pdf={{
                template: 'recipe_overview',
                data: pdfRows,
                period: { start, end },
                filename: `recipe-cost-overview-${start}_${end}`,
              }}
            />
          )}
        </>
      }
    >
      {q.isLoading && (
        <p className="text-sm text-text-secondary">Loading…</p>
      )}
      {q.error && (
        <p role="alert" className="text-sm text-danger">
          {(q.error).message}
        </p>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
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
                // Lot A2 — la navigation par ligne n'était accessible qu'à la
                // souris : focusable + Enter/Espace, destination annoncée.
                <tr
                  key={r.product_id}
                  tabIndex={0}
                  aria-label={`Open cost timeline for ${r.product_name}`}
                  className="border-t border-border-subtle cursor-pointer hover:bg-bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold"
                  data-testid={`overview-row-${r.product_id}`}
                  onClick={() => { void navigate(`/backoffice/reports/recipe-cost/${r.product_id}`); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void navigate(`/backoffice/reports/recipe-cost/${r.product_id}`);
                    }
                  }}
                >
                  <td className="py-1.5" onClick={(e) => e.stopPropagation()}>
                    <DrilldownLink entity="recipe" id={r.product_id} label={r.product_name} icon={false} />
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {r.cost_per_unit !== null ? formatIdrPrecise(r.cost_per_unit) : '—'}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {r.baseline_cost !== null ? formatIdrPrecise(r.baseline_cost) : '—'}
                  </td>
                  <td className={`py-1.5 text-right tabular-nums ${deltaTone(r.delta_pct)}`}>
                    {formatDelta(r.delta_pct)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{r.change_count}</td>
                  <td className="py-1.5 text-right tabular-nums text-text-secondary">
                    {r.created_at !== null ? toLocalDateStr(r.created_at) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ReportPage>
  );
}

export default RecipeCostOverviewPage;
