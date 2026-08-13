// apps/backoffice/src/features/inventory-dashboard/components/SalesVelocityChart.tsx
// Session 13 / Phase 2.D — daily sales bar chart.

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { formatDateShortWita } from '@breakery/utils';
import { CHART_GRID_STROKE } from '@/features/reports/utils/chartColors.js';
import { usePrefersReducedMotion } from '@/features/dashboard/utils/usePrefersReducedMotion.js';

export interface SalesVelocityChartProps {
  data: { day: string; units_sold: number }[];
  unit: string;
}

export function SalesVelocityChart({ data, unit }: SalesVelocityChartProps) {
  const reduced = usePrefersReducedMotion();
  const fmt = data.map((d) => ({
    label: formatDateShortWita(d.day),
    units: Number(d.units_sold),
  }));

  return (
    <div className="h-64 border border-border-subtle rounded-md p-3 bg-bg-elevated">
      <div className="text-xs uppercase tracking-wider text-text-secondary mb-2">
        Daily sales / production-out ({unit})
      </div>
      {/* Le nom accessible porte sur le graphe SEUL : posé sur la carte, il
          aurait masqué le titre visible au lecteur d'écran (role="img" rend
          l'élément feuille). */}
      <div
        className="h-[90%]"
        role="img"
        aria-label={`Bar chart of daily sales and production-out in ${unit} over ${fmt.length} days.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={fmt}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Bar isAnimationActive={!reduced} dataKey="units" fill="var(--gold-base)" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
