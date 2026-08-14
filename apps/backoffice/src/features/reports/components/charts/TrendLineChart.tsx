// apps/backoffice/src/features/reports/components/charts/TrendLineChart.tsx
//
// Lot B (campagne Reports 2026-08-15) — la tendance de l'archétype Report :
// ligne pleine de la période courante (`--chart-1`), ligne POINTILLÉE de la
// période de comparaison en neutre éteint — « every chart carries its
// comparison series » (README du handoff : pointillé `3 3`).

import type { JSX } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { cn } from '@breakery/ui';
import {
  COGS_BASE, CHART_SERIES_OFF, CHART_GRID_STROKE, CHART_AXIS_STROKE,
  CHART_AXIS_TICK, CHART_TOOLTIP_STYLE, formatIdrCompact, formatIdrFull,
} from '../../utils/chartColors.js';
import { usePrefersReducedMotion } from '@/features/dashboard/utils/usePrefersReducedMotion.js';

const TICK = { fontSize: 10, fill: CHART_AXIS_TICK, fontFamily: 'var(--font-data)' } as const;

export interface TrendLineChartProps {
  data: Record<string, unknown>[];
  xKey: string;
  currentKey: string;
  currentName: string;
  compareKey?: string;
  compareName?: string;
  xTickFormatter?: (v: string | number) => string;
  /** Défaut IDR compact — passer un formatteur % pour un taux. */
  yTickFormatter?: (v: number) => string;
  /** Défaut IDR complet. */
  valueFormatter?: (v: number) => string;
  ariaLabel: string;
  className?: string;
}

export function TrendLineChart({
  data, xKey, currentKey, currentName, compareKey, compareName,
  xTickFormatter, yTickFormatter = formatIdrCompact, valueFormatter = formatIdrFull,
  ariaLabel, className,
}: TrendLineChartProps): JSX.Element {
  const reduced = usePrefersReducedMotion();
  const paired = compareKey !== undefined;

  return (
    <div className={cn('h-72 w-full', className)} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey={xKey}
            tick={TICK}
            tickLine={false}
            axisLine={{ stroke: CHART_AXIS_STROKE }}
            {...(xTickFormatter !== undefined ? { tickFormatter: xTickFormatter } : {})}
          />
          <YAxis
            tick={TICK}
            tickLine={false}
            axisLine={false}
            tickFormatter={yTickFormatter}
            width={68}
          />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            formatter={(v: number, name: string) => [valueFormatter(v), name]}
          />
          {paired && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {paired && (
            <Line
              dataKey={compareKey}
              name={compareName ?? 'Previous period'}
              stroke={CHART_SERIES_OFF}
              strokeWidth={2}
              strokeDasharray="3 3"
              dot={false}
              isAnimationActive={!reduced}
            />
          )}
          <Line
            dataKey={currentKey}
            name={currentName}
            stroke={COGS_BASE}
            strokeWidth={2}
            dot={false}
            isAnimationActive={!reduced}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
