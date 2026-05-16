// apps/backoffice/src/pages/reports/ProductionYieldPage.tsx
//
// Session 15 — Phase 2.B — Production Yield report. Two sections:
//   1) Top-10 variance outliers : worst |variance_pct| within the window.
//   2) Trend per recipe          : per product, batches in window, avg + max
//                                  variance.
// Data source: direct read of `production_records` for the requested window
// (no dedicated RPC — client-side aggregation is cheap for typical
// per-30-day volumes).

import { useMemo, useState, type JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toLocalDateStr } from '@breakery/domain';
import { cn } from '@breakery/ui';
import { supabase } from '@/lib/supabase.js';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';

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

function varianceTone(pct: number | null): string {
  if (pct === null) return 'text-text-secondary';
  const abs = Math.abs(pct);
  if (abs > 15) return 'text-red-600 font-semibold';
  if (abs > 5)  return 'text-amber-600';
  return 'text-emerald-600';
}

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

function OutliersTable({ rows }: { rows: YieldRow[] }): JSX.Element {
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
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-border-subtle">
            <td className="py-2 font-mono text-xs">{r.production_number}</td>
            <td className="py-2">{r.product_name}</td>
            <td className="py-2 text-xs">{r.production_date.slice(0, 10)}</td>
            <td className="py-2 text-right tabular-nums">{r.expected_yield_qty?.toLocaleString() ?? '—'}</td>
            <td className="py-2 text-right tabular-nums">{r.actual_yield_qty?.toLocaleString() ?? '—'}</td>
            <td className={cn('py-2 text-right tabular-nums', varianceTone(r.yield_variance_pct))}>
              {r.yield_variance_pct === null
                ? '—'
                : `${r.yield_variance_pct > 0 ? '+' : ''}${r.yield_variance_pct.toFixed(1)}%`}
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
            <td className="py-2">{r.product_name}</td>
            <td className="py-2 text-right tabular-nums">{r.batches}</td>
            <td className={cn('py-2 text-right tabular-nums', varianceTone(r.avg_pct))}>
              {r.avg_pct > 0 ? '+' : ''}{r.avg_pct.toFixed(1)}%
            </td>
            <td className={cn('py-2 text-right tabular-nums', varianceTone(r.max_abs_pct))}>
              {r.max_abs_pct.toFixed(1)}%
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ProductionYieldPage(): JSX.Element {
  const [start, setStart] = useState<string>(defaultStart);
  const [end,   setEnd]   = useState<string>(() => toLocalDateStr(new Date()));
  const { data, isLoading, error } = useProductionYield(start, end);

  const outliers = useMemo(() => {
    const rows = (data ?? []).filter((r) => r.yield_variance_pct !== null);
    rows.sort((a, b) => Math.abs(b.yield_variance_pct ?? 0) - Math.abs(a.yield_variance_pct ?? 0));
    return rows.slice(0, 10);
  }, [data]);

  const trend = useMemo(() => aggregateTrend(data ?? []), [data]);

  return (
    <ReportPage
      title="Production Yield"
      subtitle="Top-10 batch variance outliers and per-recipe trend over the window."
      filters={
        <DateRangePicker
          start={start} end={end}
          onStartChange={setStart}
          onEndChange={setEnd}
        />
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
            <OutliersTable rows={outliers} />
          </section>

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
