// apps/backoffice/src/features/reports/components/charts/ParetoChart.tsx
//
// Lot B (campagne Reports 2026-08-15) — « qu'est-ce qui pèse » : barres triées
// décroissantes + ligne de CUMUL. La ligne cumule la MÊME unité que les barres
// (IDR), sur le MÊME axe — jamais un second axe en % : deux échelles Y
// indépendantes sont le mensonge de graphique n°1 (charte data-viz), et le
// cumul en valeur lit pareil (le coude est au même endroit) sans en payer le
// prix. Le pourcentage cumulé, lui, vit dans le tooltip.

import { useMemo, type JSX } from 'react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { cn } from '@breakery/ui';
import {
  COGS_BASE, CHART_2, CHART_GRID_STROKE, CHART_AXIS_STROKE,
  CHART_AXIS_TICK, CHART_TOOLTIP_STYLE, formatIdrCompact, formatIdrFull,
} from '../../utils/chartColors.js';
import { usePrefersReducedMotion } from '@/features/dashboard/utils/usePrefersReducedMotion.js';

const TICK = { fontSize: 10, fill: CHART_AXIS_TICK, fontFamily: 'var(--font-data)' } as const;
const CUMULATIVE_KEY = '__cumulative';

export interface ParetoChartProps {
  /** Lignes DÉJÀ triées par valeur décroissante — le tri est un choix métier. */
  data: Record<string, unknown>[];
  xKey: string;
  valueKey: string;
  valueName: string;
  cumulativeName?: string;
  xTickFormatter?: (v: string | number) => string;
  valueFormatter?: (v: number) => string;
  /**
   * Extension lot E — total du jeu COMPLET quand `data` n'en est qu'une coupe
   * d'affichage. Le % cumulé du tooltip se rapporte alors au tout : sans lui,
   * douze barres sur quatre-vingts refermeraient leur courbe à 100 %, ce qui
   * dirait « ces douze font tout le résultat ». Absent, le total est la somme
   * des lignes reçues (comportement du lot B).
   */
  grandTotal?: number;
  ariaLabel: string;
  className?: string;
}

export function ParetoChart({
  data, xKey, valueKey, valueName, cumulativeName = 'Cumulative',
  xTickFormatter, valueFormatter = formatIdrFull, grandTotal: grandTotalProp,
  ariaLabel, className,
}: ParetoChartProps): JSX.Element {
  const reduced = usePrefersReducedMotion();

  const { chartData, grandTotal } = useMemo(() => {
    let sum = 0;
    const rows = data.map((d) => {
      sum += Number(d[valueKey] ?? 0);
      return { ...d, [CUMULATIVE_KEY]: sum };
    });
    return { chartData: rows, grandTotal: grandTotalProp ?? sum };
  }, [data, valueKey, grandTotalProp]);

  return (
    <div className={cn('h-72 w-full', className)} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={CHART_GRID_STROKE} vertical={false} />
          <XAxis
            dataKey={xKey}
            tick={TICK}
            tickLine={false}
            axisLine={{ stroke: CHART_AXIS_STROKE }}
            interval={0}
            {...(xTickFormatter !== undefined ? { tickFormatter: xTickFormatter } : {})}
          />
          <YAxis
            tick={TICK}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatIdrCompact}
            width={68}
          />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            formatter={(v: number, name: string) => {
              if (name === cumulativeName) {
                const pct = grandTotal > 0 ? Math.round((v / grandTotal) * 100) : 0;
                return [`${valueFormatter(v)} (${pct}%)`, name];
              }
              return [valueFormatter(v), name];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar
            dataKey={valueKey}
            name={valueName}
            fill={COGS_BASE}
            radius={[2, 2, 0, 0]}
            isAnimationActive={!reduced}
          />
          <Line
            dataKey={CUMULATIVE_KEY}
            name={cumulativeName}
            stroke={CHART_2}
            strokeWidth={2}
            dot={false}
            isAnimationActive={!reduced}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
