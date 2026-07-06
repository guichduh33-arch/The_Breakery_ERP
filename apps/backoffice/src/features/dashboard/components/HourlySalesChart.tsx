// apps/backoffice/src/features/dashboard/components/HourlySalesChart.tsx
// S63 — ventes du jour par heure locale. Le RPC omet les heures sans vente ;
// l'axe 0-23 est complété à 0 ici (décision spec §4.3).

import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { EmptyState } from '@breakery/ui';
import {
  COGS_BASE, CHART_GRID_STROKE, CHART_AXIS_TICK, CHART_TOOLTIP_STYLE,
  formatIdrCompact, formatIdrFull,
} from '@/features/reports/utils/chartColors.js';
import type { HourlySale } from '../hooks/useDashboardOverview.js';

export function HourlySalesChart({ data }: { data: HourlySale[] }) {
  if (data.length === 0) {
    return (
      <div className="h-40 flex items-center justify-center">
        <EmptyState size="sm" title="No sales data yet" />
      </div>
    );
  }
  const filled = Array.from({ length: 24 }, (_, h) => {
    const found = data.find((d) => d.hour === h);
    return { hour: h, gross: found?.gross ?? 0, order_count: found?.order_count ?? 0 };
  });
  return (
    <div className="h-40">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={filled} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <CartesianGrid stroke={CHART_GRID_STROKE} vertical={false} />
          <XAxis
            dataKey="hour"
            tick={{ fontSize: 9, fill: CHART_AXIS_TICK }}
            interval={3}
          />
          <YAxis
            tick={{ fontSize: 9, fill: CHART_AXIS_TICK }}
            tickFormatter={formatIdrCompact}
            width={64}
          />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            formatter={(v: number) => [formatIdrFull(v), 'Sales']}
            labelFormatter={(h: number) => `${String(h).padStart(2, '0')}:00`}
          />
          <Bar dataKey="gross" fill={COGS_BASE} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
