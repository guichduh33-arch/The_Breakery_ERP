// apps/backoffice/src/pages/reports/ProductionYieldPage.tsx
//
// Session 15 — Phase 2.B — Production Yield report. Two sections:
//   1) Top-10 variance outliers : worst |variance_pct| within the window.
//   2) Trend per recipe          : per product, batches in window, avg + max
//                                  variance.
// Data source: direct read of `production_records` for the requested window
// (no dedicated RPC — client-side aggregation is cheap for typical
// per-30-day volumes).
//
// Number format (CLAUDE.md/spec):
//   `production_records.yield_variance_pct` is NUMERIC(7,4) stored as a
//   FRACTION (`-0.1667` = `-16.67%`). All math here keeps that fraction shape
//   internally and only multiplies by 100 at the display layer.

import { useMemo, useState, type JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toLocalDateStr, buildCsv, downloadCsv, type CsvColumn } from '@breakery/domain';
import { Button, cn } from '@breakery/ui';
import { supabase } from '@/lib/supabase.js';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { useUrlState } from '@/hooks/useUrlState.js';

interface YieldRow {
  id:                 string;
  production_number:  string;
  product_id:         string;
  product_name:       string;
  production_date:    string;
  expected_yield_qty: number | null;
  actual_yield_qty:   number | null;
  yield_variance_pct: number | null;
  yield_variance_reason: string | null;
}

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000));
}

/** Input is a FRACTION (e.g. -0.1667 = -16.67%). Thresholds: 15% / 5%. */
function varianceTone(frac: number | null): string {
  if (frac === null) return 'text-text-secondary';
  const abs = Math.abs(frac);
  if (abs > 0.15) return 'text-red-600 font-semibold';
  if (abs > 0.05) return 'text-amber-600';
  return 'text-emerald-600';
}

/** Format a fraction as a signed percent string (`+12.50%` / `-16.67%`). */
function formatVariancePct(frac: number | null): string {
  if (frac === null) return '—';
  const pct = frac * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

const YIELD_CSV_COLUMNS: CsvColumn<YieldRow>[] = [
  { header: 'production_number',    accessor: (r) => r.production_number },
  { header: 'product_name',         accessor: (r) => r.product_name },
  { header: 'production_date',      accessor: (r) => r.production_date },
  { header: 'expected_yield_qty',   accessor: (r) => r.expected_yield_qty },
  { header: 'actual_yield_qty',     accessor: (r) => r.actual_yield_qty },
  { header: 'yield_variance_pct',   accessor: (r) => r.yield_variance_pct === null ? null : (r.yield_variance_pct * 100).toFixed(4) },
  { header: 'yield_variance_reason', accessor: (r) => r.yield_variance_reason },
];

function useProductionYield(start: string, end: string) {
  return useQuery<YieldRow[]>({
    queryKey: ['reports', 'production-yield', start, end] as const,
    staleTime: 60_000,
    queryFn: async (): Promise<YieldRow[]> => {
      // production_date is timestamptz ; pad start with 00:00 and end with
      // the next-day boundary so the report is inclusive of the end date.
      const startTs = `${start}T00:00:00Z`;
      const endTs   = `${end}T23:59:59Z`;
      const { data, error } = await supabase
        .from('production_records')
        .select('id, production_number, product_id, production_date, expected_yield_qty, actual_yield_qty, yield_variance_pct, yield_variance_reason')
        .gte('production_date', startTs)
        .lte('production_date', endTs)
        .is('reverted_at', null)
        .order('production_date', { ascending: false })
        .limit(1000);
      if (error) throw error;
      const rows = data ?? [];

      const productIds = Array.from(new Set(rows.map((r) => r.product_id as string)));
      const nameById: Record<string, string> = {};
      if (productIds.length > 0) {
        const { data: prods, error: pe } = await supabase
          .from('products')
          .select('id, name')
          .in('id', productIds);
        if (pe) throw pe;
        for (const p of prods ?? []) nameById[p.id as string] = p.name as string;
      }

      return rows.map((r): YieldRow => ({
        id: r.id as string,
        production_number: r.production_number as string,
        product_id: r.product_id as string,
        product_name: nameById[r.product_id as string] ?? '—',
        production_date: r.production_date as string,
        expected_yield_qty: r.expected_yield_qty === null ? null : Number(r.expected_yield_qty),
        actual_yield_qty:   r.actual_yield_qty   === null ? null : Number(r.actual_yield_qty),
        yield_variance_pct: r.yield_variance_pct === null ? null : Number(r.yield_variance_pct),
        yield_variance_reason: r.yield_variance_reason as string | null,
      }));
    },
  });
}

interface TrendRow {
  product_id:   string;
  product_name: string;
  batches:      number;
  avg_pct:      number;
  max_abs_pct:  number;
}

function aggregateTrend(rows: YieldRow[]): TrendRow[] {
  const acc: Record<string, { name: string; sum: number; count: number; max: number }> = {};
  for (const r of rows) {
    if (r.yield_variance_pct === null) continue;
    const a = acc[r.product_id] ?? { name: r.product_name, sum: 0, count: 0, max: 0 };
    a.sum += r.yield_variance_pct;
    a.count += 1;
    const abs = Math.abs(r.yield_variance_pct);
    if (abs > a.max) a.max = abs;
    acc[r.product_id] = a;
  }
  return Object.entries(acc).map(([product_id, v]) => ({
    product_id,
    product_name: v.name,
    batches:      v.count,
    avg_pct:      v.count === 0 ? 0 : v.sum / v.count,
    max_abs_pct:  v.max,
  })).sort((a, b) => b.max_abs_pct - a.max_abs_pct);
}

function OutliersTable({
  rows, onSelectProduct, selectedProductId,
}: {
  rows: YieldRow[];
  onSelectProduct: (productId: string | null) => void;
  selectedProductId: string | null;
}): JSX.Element {
  if (rows.length === 0) {
    return <p className="text-sm text-text-secondary py-3">No yield-tracked batches in this range.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-text-secondary border-b border-border-subtle">
          <th className="py-2 text-left">Production #</th>
          <th className="py-2 text-left">Product</th>
          <th className="py-2 text-left">Date</th>
          <th className="py-2 text-right">Expected</th>
          <th className="py-2 text-right">Actual</th>
          <th className="py-2 text-right">Variance %</th>
          <th className="py-2 text-left">Reason</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const isSelected = selectedProductId === r.product_id;
          return (
            <tr
              key={r.id}
              className={cn(
                'border-b border-border-subtle cursor-pointer hover:bg-bg-elevated',
                isSelected && 'bg-bg-elevated',
              )}
              onClick={() => onSelectProduct(isSelected ? null : r.product_id)}
              aria-label={`Outlier ${r.production_number}, click to drill into product`}
              data-testid="yield-outlier-row"
            >
              <td className="py-2 font-mono text-xs">{r.production_number}</td>
              <td className="py-2" onClick={(e) => e.stopPropagation()}>
                <DrilldownLink entity="product" id={r.product_id} label={r.product_name} icon={false} />
              </td>
              <td className="py-2 text-xs">{r.production_date.slice(0, 10)}</td>
              <td className="py-2 text-right tabular-nums">{r.expected_yield_qty?.toLocaleString() ?? '—'}</td>
              <td className="py-2 text-right tabular-nums">{r.actual_yield_qty?.toLocaleString() ?? '—'}</td>
              <td className={cn('py-2 text-right tabular-nums', varianceTone(r.yield_variance_pct))}>
                {formatVariancePct(r.yield_variance_pct)}
              </td>
              <td className="py-2 text-xs text-text-secondary truncate max-w-[18rem]">
                {r.yield_variance_reason ?? '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function DrillDownPanel({ rows }: { rows: YieldRow[] }): JSX.Element {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-text-secondary border-b border-border-subtle">
          <th className="py-2 text-left">Production #</th>
          <th className="py-2 text-left">Date</th>
          <th className="py-2 text-right">Expected</th>
          <th className="py-2 text-right">Actual</th>
          <th className="py-2 text-right">Variance %</th>
          <th className="py-2 text-left">Reason</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-border-subtle" data-testid="yield-drilldown-row">
            <td className="py-2 font-mono text-xs">{r.production_number}</td>
            <td className="py-2 text-xs">{r.production_date.slice(0, 10)}</td>
            <td className="py-2 text-right tabular-nums">{r.expected_yield_qty?.toLocaleString() ?? '—'}</td>
            <td className="py-2 text-right tabular-nums">{r.actual_yield_qty?.toLocaleString() ?? '—'}</td>
            <td className={cn('py-2 text-right tabular-nums', varianceTone(r.yield_variance_pct))}>
              {formatVariancePct(r.yield_variance_pct)}
            </td>
            <td className="py-2 text-xs text-text-secondary truncate max-w-[18rem]">
              {r.yield_variance_reason ?? '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TrendTable({ rows }: { rows: TrendRow[] }): JSX.Element {
  if (rows.length === 0) {
    return <p className="text-sm text-text-secondary py-3">No recipes with yield data in this range.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-text-secondary border-b border-border-subtle">
          <th className="py-2 text-left">Product</th>
          <th className="py-2 text-right">Batches</th>
          <th className="py-2 text-right">Avg variance %</th>
          <th className="py-2 text-right">Max |variance %|</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.product_id} className="border-b border-border-subtle">
            <td className="py-2">
              <DrilldownLink entity="recipe" id={r.product_id} label={r.product_name} icon={false} />
            </td>
            <td className="py-2 text-right tabular-nums">{r.batches}</td>
            <td className={cn('py-2 text-right tabular-nums', varianceTone(r.avg_pct))}>
              {formatVariancePct(r.avg_pct)}
            </td>
            <td className={cn('py-2 text-right tabular-nums', varianceTone(r.max_abs_pct))}>
              {formatVariancePct(r.max_abs_pct).replace('+', '')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ProductionYieldPage(): JSX.Element {
  const [start, setStart] = useUrlState('start', defaultStart());
  const [end,   setEnd]   = useUrlState('end', toLocalDateStr(new Date()));
  const [drillProductId, setDrillProductId] = useState<string | null>(null);
  const { data, isLoading, error } = useProductionYield(start, end);

  const yieldRows = useMemo(
    () => (data ?? []).filter((r) => r.yield_variance_pct !== null),
    [data],
  );

  const outliers = useMemo(() => {
    const rows = [...yieldRows];
    rows.sort((a, b) => Math.abs(b.yield_variance_pct ?? 0) - Math.abs(a.yield_variance_pct ?? 0));
    return rows.slice(0, 10);
  }, [yieldRows]);

  const trend = useMemo(() => aggregateTrend(data ?? []), [data]);

  const drillRows = useMemo(() => {
    if (drillProductId === null) return [];
    return yieldRows
      .filter((r) => r.product_id === drillProductId)
      .sort((a, b) => b.production_date.localeCompare(a.production_date));
  }, [drillProductId, yieldRows]);

  const drillProductName =
    drillProductId === null
      ? null
      : (yieldRows.find((r) => r.product_id === drillProductId)?.product_name ?? null);

  function handleExportCsv(): void {
    const csv = buildCsv(yieldRows, YIELD_CSV_COLUMNS);
    downloadCsv(csv, `production-yield-${start}_to_${end}.csv`);
  }

  return (
    <ReportPage
      title="Production Yield"
      subtitle="Top-10 batch variance outliers and per-recipe trend over the window."
      filters={
        <>
          <DateRangePicker
            start={start} end={end}
            onStartChange={setStart}
            onEndChange={setEnd}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleExportCsv}
            disabled={yieldRows.length === 0}
            data-testid="yield-export-csv"
          >
            Export CSV
          </Button>
        </>
      }
    >
      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {error && (
        <p role="alert" className="text-sm text-red-500">
          {(error as Error).message ?? 'Failed to load report.'}
        </p>
      )}
      {data !== undefined && (
        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-xs uppercase tracking-widest text-text-secondary">
              Top-10 variance outliers
            </h2>
            <OutliersTable
              rows={outliers}
              onSelectProduct={setDrillProductId}
              selectedProductId={drillProductId}
            />
          </section>

          {drillProductId !== null && (
            <section className="space-y-2" data-testid="yield-drilldown-section">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xs uppercase tracking-widest text-text-secondary">
                  Drill-down · {drillProductName ?? drillProductId}
                </h2>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setDrillProductId(null)}
                >
                  Clear
                </Button>
              </div>
              <DrillDownPanel rows={drillRows} />
            </section>
          )}

          <section className="space-y-2">
            <h2 className="text-xs uppercase tracking-widest text-text-secondary">
              Trend per recipe
            </h2>
            <TrendTable rows={trend} />
          </section>
        </div>
      )}
    </ReportPage>
  );
}
