// apps/backoffice/src/features/dashboard/components/RevenueTrendChart.tsx
//
// Écran 1c — CA net sur 30 jours, superposé aux 30 jours PRÉCÉDENTS.
//
// La comparaison est le sujet du graphe, pas un ornement : une courbe seule
// laisse juger « ça monte » sans repère, alors qu'un mois de boulangerie a une
// forme (week-ends, jours fériés) qui ne se lit que contre le mois d'avant. La
// série passée est en pointillé gris et sans point : elle doit être LISIBLE
// sans jamais gagner l'œil contre la série courante.

import type { JSX } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { EmptyState } from '@breakery/ui';
import {
  COGS_BASE, CHART_SERIES_OFF, CHART_GRID_STROKE, CHART_AXIS_STROKE,
  CHART_AXIS_TICK, CHART_TOOLTIP_STYLE, formatIdrCompact, formatIdrFull,
} from '@/features/reports/utils/chartColors.js';
import { usePrefersReducedMotion } from '../utils/usePrefersReducedMotion.js';
import type { RevenueDay } from '../hooks/useDashboardOverview.js';

const TICK = { fontSize: 10, fill: CHART_AXIS_TICK, fontFamily: 'var(--font-data)' } as const;

export function RevenueTrendChart({ data }: { data: RevenueDay[] }): JSX.Element {
  const reduced = usePrefersReducedMotion();
  const hasData = data.some((d) => d.net !== 0 || (d.prev_net ?? 0) !== 0);

  if (!hasData) {
    return (
      <div className="flex h-44 items-center justify-center">
        <EmptyState
          size="sm"
          title="No revenue data"
          description="The trend appears once orders are recorded."
        />
      </div>
    );
  }

  return (
    <div className="h-44">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={CHART_GRID_STROKE} vertical={false} />
          <XAxis
            dataKey="date"
            tick={TICK}
            tickLine={false}
            axisLine={{ stroke: CHART_AXIS_STROKE }}
            tickFormatter={(d: string) => d.slice(5)}
            interval={6}
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
          />
          {/* La série passée est déclarée EN PREMIER : recharts empile dans
              l'ordre de déclaration, et la courbe du jour doit passer dessus. */}
          <Line
            type="monotone"
            dataKey="prev_net"
            name="Previous 30 d"
            stroke={CHART_SERIES_OFF}
            strokeWidth={1.5}
            strokeDasharray="3 3"
            dot={false}
            isAnimationActive={!reduced}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="net"
            name="Net revenue"
            stroke={COGS_BASE}
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={!reduced}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
