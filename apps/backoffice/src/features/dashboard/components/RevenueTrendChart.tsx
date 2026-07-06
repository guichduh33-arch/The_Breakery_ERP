// apps/backoffice/src/features/dashboard/components/RevenueTrendChart.tsx
// S63 — tendance 30 j (net/jour). Série continue fournie par le RPC.

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { EmptyState } from '@breakery/ui';
import {
  COGS_BASE, CHART_GRID_STROKE, CHART_AXIS_TICK, CHART_TOOLTIP_STYLE,
  formatIdrCompact, formatIdrFull,
} from '@/features/reports/utils/chartColors.js';
import type { RevenueDay } from '../hooks/useDashboardOverview.js';

export function RevenueTrendChart({ data }: { data: RevenueDay[] }) {
  const hasData = data.some((d) => d.net !== 0 || d.order_count !== 0);
  if (!hasData) {
    return (
      <div className="h-48 flex items-center justify-center">
        <EmptyState
          size="sm"
          title="No revenue data"
          description="Trend chart appears once orders are recorded."
        />
      </div>
    );
  }
  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid stroke={CHART_GRID_STROKE} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: CHART_AXIS_TICK }}
            tickFormatter={(d: string) => d.slice(5)}
            interval={6}
          />
          <YAxis
            tick={{ fontSize: 10, fill: CHART_AXIS_TICK }}
            tickFormatter={formatIdrCompact}
            width={72}
          />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            formatter={(v: number) => [formatIdrFull(v), 'Net revenue']}
          />
          <Line type="monotone" dataKey="net" stroke={COGS_BASE} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
