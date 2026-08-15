// apps/backoffice/src/features/reports/components/charts/StackedBarsChart.tsx
//
// Lot E (campagne Reports 2026-08-15) — extension ADDITIVE du socle : la
// COMPOSITION d'un total dans le temps. Les méthodes de paiement d'une journée,
// ou les deux familles de coût d'une journée, ne sont pas des séries rivales :
// elles S'ADDITIONNENT au total du jour. Les empiler est la lecture juste ; les
// juxtaposer (PairedBarsChart) inviterait à les comparer entre elles.
//
// Pourquoi des barres et non l'aire empilée qu'avaient PaymentByMethod et
// CostSpend : une aire interpole entre deux jours et donne un continuum là où
// il n'y a que des relevés journaliers discrets. Le lecteur y lit une valeur au
// milieu d'un segment, qui n'existe pas.
//
// Data-viz : plusieurs séries → légende obligatoire ; un filet de la couleur de
// la carte sépare les segments (le « 2 px surface gap » de la charte, que
// recharts ne sait poser qu'en contour) ; le coin arrondi ne va qu'au segment
// de tête, seul à toucher le haut de la pile.

import type { JSX } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { cn } from '@breakery/ui';
import {
  CHART_GRID_STROKE, CHART_AXIS_STROKE, CHART_AXIS_TICK, CHART_TOOLTIP_STYLE,
  formatIdrCompact, formatIdrFull,
} from '../../utils/chartColors.js';
import { usePrefersReducedMotion } from '@/features/dashboard/utils/usePrefersReducedMotion.js';

const TICK = { fontSize: 10, fill: CHART_AXIS_TICK, fontFamily: 'var(--font-data)' } as const;

export interface StackedSeries {
  /** Clé de la valeur dans chaque ligne de `data`. */
  key:   string;
  /** Nom lisible — légende ET tooltip. */
  name:  string;
  /** Un cran de rampe du thème, jamais `cat-*` ni un hex de page. */
  color: string;
}

export interface StackedBarsChartProps {
  data: Record<string, unknown>[];
  xKey: string;
  /** Ordre d'empilement, du bas vers le haut. Il suit l'IDENTITÉ des séries et
   *  non leur rang : un tri par valeur repeindrait la pile à chaque période. */
  series: StackedSeries[];
  xTickFormatter?: (v: string | number) => string;
  yTickFormatter?: (v: number) => string;
  valueFormatter?: (v: number) => string;
  ariaLabel: string;
  /** Hauteur par classe — défaut `h-72`. */
  className?: string;
}

export function StackedBarsChart({
  data, xKey, series,
  xTickFormatter, yTickFormatter = formatIdrCompact, valueFormatter = formatIdrFull,
  ariaLabel, className,
}: StackedBarsChartProps): JSX.Element {
  const reduced = usePrefersReducedMotion();
  const last = series.length - 1;

  return (
    <div className={cn('h-72 w-full', className)} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              stackId="stack"
              fill={s.color}
              stroke="var(--surface-3)"
              strokeWidth={1}
              {...(i === last ? { radius: [2, 2, 0, 0] as [number, number, number, number] } : {})}
              isAnimationActive={!reduced}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
