// apps/backoffice/src/features/reports/components/charts/PairedBarsChart.tsx
//
// Lot B (campagne Reports 2026-08-15) — le graphe principal de l'archétype
// Report : barres de la période courante (`--chart-1`) appariées à la période
// de comparaison (`--chart-4`, pâle, en retrait). Généralise HourlySalesChart
// (dashboard), qui reste le gabarit de référence.
//
// Data-viz : deux séries → légende obligatoire ; les deux crans sont les
// EXTRÊMES de la rampe séquentielle (ΔE maximal), jamais deux crans voisins.

import type { JSX } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { cn } from '@breakery/ui';
import {
  COGS_BASE, CHART_SERIES_COMPARE, CHART_GRID_STROKE, CHART_AXIS_STROKE,
  CHART_AXIS_TICK, CHART_TOOLTIP_STYLE, formatIdrCompact, formatIdrFull,
} from '../../utils/chartColors.js';
import { usePrefersReducedMotion } from '@/features/dashboard/utils/usePrefersReducedMotion.js';

const TICK = { fontSize: 10, fill: CHART_AXIS_TICK, fontFamily: 'var(--font-data)' } as const;

export interface PairedBarsChartProps {
  data: Record<string, unknown>[];
  xKey: string;
  currentKey: string;
  currentName: string;
  compareKey?: string;
  compareName?: string;
  /** Formatteur des ticks X (heures, dates courtes…). */
  xTickFormatter?: (v: string | number) => string;
  /** Formatteur de l'axe Y — défaut IDR compact. */
  yTickFormatter?: (v: number) => string;
  /** Formatteur du tooltip — défaut IDR complet. */
  valueFormatter?: (v: number) => string;
  ariaLabel: string;
  /** Hauteur par classe — défaut `h-72`. */
  className?: string;
}

export function PairedBarsChart({
  data, xKey, currentKey, currentName, compareKey, compareName,
  xTickFormatter, yTickFormatter = formatIdrCompact, valueFormatter = formatIdrFull,
  ariaLabel, className,
}: PairedBarsChartProps): JSX.Element {
  const reduced = usePrefersReducedMotion();
  const paired = compareKey !== undefined;

  return (
    <div className={cn('h-72 w-full', className)} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2}>
          <CartesianGrid stroke={CHART_GRID_STROKE} vertical={false} />
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
          <Bar
            dataKey={currentKey}
            name={currentName}
            fill={COGS_BASE}
            radius={[2, 2, 0, 0]}
            isAnimationActive={!reduced}
          />
          {paired && (
            <Bar
              dataKey={compareKey}
              name={compareName ?? 'Previous period'}
              fill={CHART_SERIES_COMPARE}
              radius={[2, 2, 0, 0]}
              isAnimationActive={!reduced}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
