// apps/backoffice/src/features/dashboard/components/RevenueByTypeDonut.tsx
// S63 — revenu du jour par type de commande (donut).

import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { EmptyState } from '@breakery/ui';
import {
  familyColor, CHART_TOOLTIP_STYLE, formatIdrFull,
} from '@/features/reports/utils/chartColors.js';
import type { RevenueByType } from '../hooks/useDashboardOverview.js';

const TYPE_LABELS: Record<string, string> = {
  dine_in: 'Dine-in',
  take_out: 'Take-out',
  delivery: 'Delivery',
  b2b: 'B2B',
};

export function RevenueByTypeDonut({ data }: { data: RevenueByType[] }) {
  if (data.length === 0) {
    return (
      <div className="h-56 flex items-center justify-center">
        <EmptyState size="sm" title="No data available" />
      </div>
    );
  }
  const rows = data.map((d) => ({
    ...d,
    label: TYPE_LABELS[d.order_type] ?? d.order_type,
  }));
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={rows}
            dataKey="gross"
            nameKey="label"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={2}
          >
            {rows.map((row, i) => (
              <Cell key={row.order_type} fill={familyColor('cogs', i)} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            formatter={(v: number) => formatIdrFull(v)}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
