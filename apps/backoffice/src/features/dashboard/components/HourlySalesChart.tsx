// apps/backoffice/src/features/dashboard/components/HourlySalesChart.tsx
//
// Écran 1c — profil horaire du jour contre le MÊME JOUR DE SEMAINE passé.
//
// La RPC renvoie déjà les 12 tranches 06:00→17:00, heures creuses comprises à
// zéro. On ne complète donc plus rien ici : un trou dans un graphe horaire se
// lit comme une fermeture, et c'est au serveur de dire ce qui est fermé.
//
// Le comparatif est le même jour la semaine passée, jamais une moyenne 7 j :
// comparer un mercredi à une moyenne lissée dirait n'importe quoi.

import type { JSX } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { EmptyState } from '@breakery/ui';
import {
  COGS_BASE, CHART_SERIES_COMPARE, CHART_GRID_STROKE, CHART_AXIS_STROKE,
  CHART_AXIS_TICK, CHART_TOOLTIP_STYLE, formatIdrCompact, formatIdrFull,
} from '@/features/reports/utils/chartColors.js';
import { usePrefersReducedMotion } from '../utils/usePrefersReducedMotion.js';
import type { HourlyBucket } from '../hooks/useDashboardOverview.js';

const TICK = { fontSize: 10, fill: CHART_AXIS_TICK, fontFamily: 'var(--font-data)' } as const;

export function HourlySalesChart({ data }: { data: HourlyBucket[] }): JSX.Element {
  const reduced = usePrefersReducedMotion();
  const hasData = data.some((d) => d.today !== 0 || d.last_week !== 0);

  if (!hasData) {
    return (
      <div className="flex h-44 items-center justify-center">
        <EmptyState size="sm" title="No sales today yet" />
      </div>
    );
  }

  return (
    <div className="h-44">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2}>
          <CartesianGrid stroke={CHART_GRID_STROKE} vertical={false} />
          <XAxis
            dataKey="hour"
            tick={TICK}
            tickLine={false}
            axisLine={{ stroke: CHART_AXIS_STROKE }}
            tickFormatter={(h: number) => String(h).padStart(2, '0')}
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
            formatter={(v: number, name: string) => [formatIdrFull(v), name]}
            labelFormatter={(h: number) => `${String(h).padStart(2, '0')}:00`}
          />
          <Bar dataKey="today" name="Today" fill={COGS_BASE} radius={[2, 2, 0, 0]} isAnimationActive={!reduced} />
          <Bar dataKey="last_week" name="Same weekday last week" fill={CHART_SERIES_COMPARE} radius={[2, 2, 0, 0]} isAnimationActive={!reduced} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
