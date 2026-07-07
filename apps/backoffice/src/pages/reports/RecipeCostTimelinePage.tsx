// apps/backoffice/src/pages/reports/RecipeCostTimelinePage.tsx
// Session 18 — Phase 2.B — Single-recipe cost timeline with LineChart.
//
// Consumes recipe_cost_history_v1(from, to, productId) in drill-down mode.
// Renders a recharts LineChart of cost_per_unit over time + a version
// table with delta-vs-prev computed client-side. CSV export.
// Reached from RecipeCostOverviewPage (Phase 2.A) row click.

import { useMemo, type JSX } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';
import { toLocalDateStr, buildCsv, downloadCsv, type CsvColumn } from '@breakery/domain';
import { Button } from '@breakery/ui';
import { supabase } from '@/lib/supabase.js';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { useUrlState } from '@/hooks/useUrlState.js';
import { CHART_GRID_STROKE } from '@/features/reports/utils/chartColors.js';

interface TimelineRow {
  product_id:     string;
  product_name:   string;
  version_number: number;
  created_at:     string;
  cost_per_unit:  number;
  change_note:    string | null;
}

interface TimelineRowWithDelta extends TimelineRow {
  delta_pct: number | null;
}

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 89 * 86_400_000));
}

/** Delta tone — thresholds are percentage points (not fractions). */
function deltaTone(d: number | null): string {
  if (d === null) return 'text-text-secondary';
  const abs = Math.abs(d);
  if (abs > 20) return 'text-danger font-semibold';
  if (abs > 5)  return 'text-warning';
  return 'text-success';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const TIMELINE_CSV_COLUMNS: CsvColumn<TimelineRowWithDelta>[] = [
  { header: 'version_number',    accessor: (r) => r.version_number },
  { header: 'created_at',        accessor: (r) => r.created_at },
  { header: 'cost_per_unit',     accessor: (r) => r.cost_per_unit },
  { header: 'delta_vs_prev_pct', accessor: (r) => r.delta_pct !== null ? r.delta_pct.toFixed(2) : '' },
  { header: 'change_note',       accessor: (r) => r.change_note ?? '' },
];

export function RecipeCostTimelinePage(): JSX.Element {
  const { productId = '' } = useParams<{ productId: string }>();
  const [from, setFrom] = useUrlState('from', defaultStart());
  const [to,   setTo]   = useUrlState('to', toLocalDateStr(new Date()));

  const q = useQuery<TimelineRow[]>({
    queryKey: ['reports', 'recipe-cost', 'timeline', productId, from, to] as const,
    enabled: productId !== '',
    staleTime: 60_000,
    queryFn: async (): Promise<TimelineRow[]> => {
      const { data, error } = await supabase.rpc('recipe_cost_history_v1', {
        p_from: from,
        p_to: to,
        p_product_id: productId,
      });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const rows = q.data ?? [];
  const productName = rows[0]?.product_name ?? 'Recipe Cost Timeline';

  const rowsWithDelta = useMemo<TimelineRowWithDelta[]>(() => {
    return rows.map((r, i) => {
      const prev = rows[i - 1]?.cost_per_unit;
      const delta = (prev === undefined || prev === 0)
        ? null
        : round2(((r.cost_per_unit - prev) / prev) * 100);
      return { ...r, delta_pct: delta };
    });
  }, [rows]);

  const chartData = useMemo(() => rows.map((r) => ({
    date: r.created_at.slice(0, 10),
    cost: r.cost_per_unit,
    note: r.change_note ?? '',
  })), [rows]);

  function handleCsv(): void {
    const safeName = productName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const csv = buildCsv(rowsWithDelta, TIMELINE_CSV_COLUMNS);
    downloadCsv(csv, `recipe-cost-timeline-${safeName}-${from}_${to}.csv`);
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
          <DateRangePicker
            start={from}
            end={to}
            onStartChange={setFrom}
            onEndChange={setTo}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCsv}
            disabled={rows.length === 0}
            data-testid="timeline-export-csv"
          >
            Export CSV
          </Button>
        </>
      }
    >
      <div className="mb-4">
        <Link
          to="/backoffice/reports/recipe-cost"
          className="text-xs text-text-secondary hover:underline"
          data-testid="timeline-back-link"
        >
          ← Recipe Cost Overview
        </Link>
      </div>

      {q.isLoading && (
        <p className="text-sm text-text-secondary">Loading…</p>
      )}
      {q.error && (
        <p role="alert" className="text-sm text-danger">
          {(q.error).message}
        </p>
      )}
      {!q.isLoading && !q.error && rows.length === 0 && (
        <p className="text-sm text-text-secondary" data-testid="empty-timeline">
          No cost history for this product in the selected window.
        </p>
      )}
      {rows.length > 0 && (
        <>
          <div data-testid="timeline-chart" style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="cost"
                  // No design-system token maps to this amber (not COGS/OpEx —
                  // recipe cost-per-unit line). Kept literal — see S59 T7 report.
                  stroke="#d4a437"
                  strokeWidth={2}
                  dot
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <table className="w-full text-sm mt-6" data-testid="timeline-table">
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest text-text-secondary border-b border-border-subtle">
                <th className="py-2">Version</th>
                <th className="py-2">Date</th>
                <th className="py-2 text-right">Cost</th>
                <th className="py-2 text-right">Δ vs prev</th>
                <th className="py-2">Change note</th>
              </tr>
            </thead>
            <tbody>
              {rowsWithDelta.map((r) => (
                <tr
                  key={`${r.product_id}-${r.version_number}`}
                  className="border-t border-border-subtle"
                  data-testid={`timeline-row-v${r.version_number}`}
                >
                  <td className="py-1.5 tabular-nums">v{r.version_number}</td>
                  <td className="py-1.5 tabular-nums text-text-secondary">
                    {r.created_at.slice(0, 19).replace('T', ' ')}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {r.cost_per_unit.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                  </td>
                  <td className={`py-1.5 text-right tabular-nums ${deltaTone(r.delta_pct)}`}>
                    {r.delta_pct === null
                      ? '—'
                      : (r.delta_pct > 0 ? '+' : '') + r.delta_pct.toFixed(2) + '%'}
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

export default RecipeCostTimelinePage;
