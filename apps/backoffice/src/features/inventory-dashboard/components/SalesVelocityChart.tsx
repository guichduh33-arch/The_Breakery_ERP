// apps/backoffice/src/features/inventory-dashboard/components/SalesVelocityChart.tsx
// Session 13 / Phase 2.D — daily sales bar chart.

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { CHART_GRID_STROKE } from '@/features/reports/utils/chartColors.js';

export interface SalesVelocityChartProps {
  data: { day: string; units_sold: number }[];
  unit: string;
}

export function SalesVelocityChart({ data, unit }: SalesVelocityChartProps) {
  const fmt = data.map((d) => ({
    label: new Date(d.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    units: Number(d.units_sold),
  }));

  return (
    <div className="h-64 border border-border-subtle rounded-md p-3 bg-bg-elevated">
      <div className="text-xs uppercase tracking-wider text-text-secondary mb-2">
        Daily sales / production-out ({unit})
      </div>
      <ResponsiveContainer width="100%" height="90%">
        <BarChart data={fmt}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip />
          <Bar dataKey="units" fill="var(--gold-base)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
