// apps/backoffice/src/pages/reports/CostSpendAnalyticsPage.tsx
//
// Cost & Spend Analytics — the consolidated cost dashboard. Brings the two P&L
// cost buckets side by side under one "two cost families" color language:
//   • Material purchasing (COGS proxy) → BLUE
//   • Operating expenses (OpEx)        → AMBER
// Hero = stacked daily spend composition; two donuts ventilate each bucket by
// category; a split bar shows the COGS↔OpEx ratio with revenue context.

import { useMemo, useState } from 'react';
import {
  Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { toLocalDateStr } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import { ChartCard } from '@/features/reports/components/ChartCard.js';
import { CostDonut } from '@/features/reports/components/CostDonut.js';
import { usePurchaseCogsBreakdown } from '@/features/reports/hooks/usePurchaseCogsBreakdown.js';
import { useExpensesByCategory } from '@/features/reports/hooks/useExpensesByCategory.js';
import { useProfitLoss } from '@/features/reports/hooks/useProfitLoss.js';
import {
  COGS_BASE, OPEX_BASE,
  CHART_GRID_STROKE, CHART_AXIS_TICK, CHART_TOOLTIP_STYLE,
  formatIdrFull, formatIdrCompact,
} from '@/features/reports/utils/chartColors.js';

interface DailyCost { date: string; cogs: number; opex: number }

const csvColumns: CsvColumn<DailyCost>[] = [
  { header: 'Date',             accessor: (r) => r.date,            format: 'text' },
  { header: 'Purchases (IDR)',  accessor: (r) => r.cogs,            format: 'idr-round100' },
  { header: 'OpEx (IDR)',       accessor: (r) => r.opex,            format: 'idr-round100' },
  { header: 'Total (IDR)',      accessor: (r) => r.cogs + r.opex,   format: 'idr-round100' },
];

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000));
}

/** KPI tile carrying a cost-family accent bar. */
function FamilyKpi({
  label, value, accent, sub,
}: { label: string; value: string; accent?: string | undefined; sub?: string | undefined }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-border-subtle bg-surface-2 p-4">
      {accent && (
        <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: accent }} aria-hidden />
      )}
      <p className="pl-2 text-xs uppercase tracking-wide text-text-secondary">{label}</p>
      <p className="mt-1 pl-2 font-mono text-2xl font-semibold tabular-nums text-text-primary">{value}</p>
      {sub && <p className="mt-0.5 pl-2 text-xs text-text-muted">{sub}</p>}
    </div>
  );
}

export default function CostSpendAnalyticsPage() {
  const [start, setStart] = useState<string>(defaultStart);
  const [end,   setEnd]   = useState<string>(() => toLocalDateStr(new Date()));

  const cogs = usePurchaseCogsBreakdown({ start, end });
  const opex = useExpensesByCategory({ start, end });
  const pnl  = useProfitLoss(start, end);

  const purchasesTotal = cogs.data?.summary.total ?? 0;
  const opexTotal      = opex.data?.summary.total ?? 0;
  const totalSpend     = purchasesTotal + opexTotal;
  const revenue        = pnl.data?.revenue.total ?? 0;

  const pctOfSales = (n: number) => (revenue > 0 ? `${((n / revenue) * 100).toFixed(1)}% of sales` : undefined);

  // Merge the two daily series into one stacked dataset.
  const series = useMemo<DailyCost[]>(() => {
    const map = new Map<string, DailyCost>();
    for (const d of cogs.data?.by_day ?? []) {
      map.set(d.date, { date: d.date, cogs: d.total, opex: 0 });
    }
    for (const d of opex.data?.by_day ?? []) {
      const cur = map.get(d.date) ?? { date: d.date, cogs: 0, opex: 0 };
      cur.opex = d.total;
      map.set(d.date, cur);
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [cogs.data, opex.data]);

  const purchaseDonut = (cogs.data?.by_category ?? []).map((c) => ({ name: c.name, value: c.total }));
  const opexDonut     = (opex.data?.by_category ?? []).map((c) => ({ name: c.name, value: c.total }));

  const cogsShare = totalSpend > 0 ? (purchasesTotal / totalSpend) * 100 : 0;
  const opexShare = totalSpend > 0 ? (opexTotal / totalSpend) * 100 : 0;

  const isLoading = cogs.isLoading || opex.isLoading;
  const error = cogs.error ?? opex.error;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-serif">Cost &amp; Spend Analytics</h1>
          <p className="text-sm text-text-secondary">
            Material purchasing (COGS) and operating expenses for a period.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <DateRangePicker start={start} end={end} onStartChange={setStart} onEndChange={setEnd} />
          <ExportButtons
            csv={{ rows: series, columns: csvColumns, filename: `cost-spend-${start}_${end}` }}
          />
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error.message ?? 'Failed to load cost analytics.'}
        </p>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <FamilyKpi label="Material purchases" value={formatIdrCompact(purchasesTotal)} accent={COGS_BASE}
          sub={pctOfSales(purchasesTotal)} />
        <FamilyKpi label="Operating expenses" value={formatIdrCompact(opexTotal)} accent={OPEX_BASE}
          sub={pctOfSales(opexTotal)} />
        <FamilyKpi label="Total spend" value={formatIdrCompact(totalSpend)}
          sub={pctOfSales(totalSpend)} />
        <FamilyKpi label="Revenue (period)" value={formatIdrCompact(revenue)}
          sub={revenue > 0 ? `${(((revenue - totalSpend) / revenue) * 100).toFixed(0)}% left after spend` : undefined} />
      </div>

      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}

      {/* Hero — stacked daily composition */}
      <ChartCard
        title="Spend composition"
        subtitle="Daily material purchases vs operating expenses"
        accent={COGS_BASE}
      >
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
              <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => d.slice(5)}
                tick={{ fontSize: 11, fill: CHART_AXIS_TICK }}
                tickLine={false}
              />
              <YAxis
                tickFormatter={formatIdrCompact}
                tick={{ fontSize: 11, fill: CHART_AXIS_TICK }}
                tickLine={false}
                width={72}
              />
              <Tooltip
                formatter={(v: number, n: string) => [formatIdrFull(v), n]}
                contentStyle={CHART_TOOLTIP_STYLE}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="cogs" name="Purchases" stackId="1"
                stroke={COGS_BASE} fill={COGS_BASE} fillOpacity={0.85} />
              <Area type="monotone" dataKey="opex" name="OpEx" stackId="1"
                stroke={OPEX_BASE} fill={OPEX_BASE} fillOpacity={0.85} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      {/* Two category donuts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Purchases by category" subtitle="Material spend per product category" accent={COGS_BASE}>
          <CostDonut data={purchaseDonut} family="cogs" centerLabel="Purchases" />
        </ChartCard>
        <ChartCard title="OpEx by category" subtitle="Operating expense per category" accent={OPEX_BASE}>
          <CostDonut data={opexDonut} family="opex" centerLabel="OpEx" />
        </ChartCard>
      </div>

      {/* COGS ↔ OpEx split */}
      <ChartCard title="Cost structure" subtitle="Share of total spend by cost family">
        <div className="flex h-7 w-full overflow-hidden rounded-md border border-border-subtle">
          {cogsShare > 0 && (
            <div className="flex items-center justify-center text-[11px] font-medium text-white"
              style={{ width: `${cogsShare}%`, backgroundColor: COGS_BASE }}>
              {cogsShare >= 12 ? `${cogsShare.toFixed(0)}%` : ''}
            </div>
          )}
          {opexShare > 0 && (
            <div className="flex items-center justify-center text-[11px] font-medium text-white"
              style={{ width: `${opexShare}%`, backgroundColor: OPEX_BASE }}>
              {opexShare >= 12 ? `${opexShare.toFixed(0)}%` : ''}
            </div>
          )}
          {totalSpend === 0 && (
            <div className="flex w-full items-center justify-center text-xs text-text-muted">
              No spend in this period.
            </div>
          )}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: COGS_BASE }} aria-hidden />
            <span className="text-text-secondary">Purchases</span>
            <span className="ml-auto font-mono tabular-nums text-text-primary">{formatIdrFull(purchasesTotal)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: OPEX_BASE }} aria-hidden />
            <span className="text-text-secondary">OpEx</span>
            <span className="ml-auto font-mono tabular-nums text-text-primary">{formatIdrFull(opexTotal)}</span>
          </div>
        </div>
      </ChartCard>
    </div>
  );
}
