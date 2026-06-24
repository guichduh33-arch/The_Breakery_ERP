// apps/backoffice/src/features/reports/components/CostDonut.tsx
//
// Donut for a category breakdown, colored by a single cost family ramp.
// Center shows the total; a compact legend lists each slice with its share.

import type { JSX } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import {
  familyColor,
  formatIdrFull,
  formatIdrCompact,
  CHART_TOOLTIP_STYLE,
  type CostFamily,
} from '../utils/chartColors.js';

export interface CostDonutDatum {
  name:  string;
  value: number;
}

export interface CostDonutProps {
  data:    CostDonutDatum[];
  family:  CostFamily;
  height?: number;
  /** Label under the center total (e.g. "Total achats"). */
  centerLabel?: string;
  /** Cap legend rows; remainder folded into "+N more". */
  maxLegend?: number;
}

export function CostDonut({
  data,
  family,
  height = 220,
  centerLabel,
  maxLegend = 6,
}: CostDonutProps): JSX.Element {
  const rows = data.filter((d) => d.value > 0);
  const total = rows.reduce((s, d) => s + d.value, 0);

  if (rows.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-text-muted"
        style={{ height }}
      >
        No data for this period.
      </div>
    );
  }

  const legend = rows.slice(0, maxLegend);
  const hiddenCount = rows.length - legend.length;

  return (
    <div>
      <div className="relative w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={rows}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={1.5}
              stroke="none"
            >
              {rows.map((d, i) => (
                <Cell key={d.name} fill={familyColor(family, i)} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v: number, n: string) => [formatIdrFull(v), n]}
              contentStyle={CHART_TOOLTIP_STYLE}
            />
          </PieChart>
        </ResponsiveContainer>
        {/* Center total */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-base font-semibold tabular-nums text-text-primary">
            {formatIdrCompact(total)}
          </span>
          {centerLabel && (
            <span className="mt-0.5 text-[11px] uppercase tracking-wide text-text-muted">
              {centerLabel}
            </span>
          )}
        </div>
      </div>
      <ul className="mt-3 space-y-1.5">
        {legend.map((d, i) => {
          const pct = total > 0 ? (d.value / total) * 100 : 0;
          return (
            <li key={d.name} className="flex items-center gap-2 text-xs">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: familyColor(family, i) }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-text-secondary">{d.name}</span>
              <span className="shrink-0 font-mono tabular-nums text-text-primary">
                {formatIdrCompact(d.value)}
              </span>
              <span className="w-12 shrink-0 text-right tabular-nums text-text-muted">
                {pct.toFixed(1)}%
              </span>
            </li>
          );
        })}
        {hiddenCount > 0 && (
          <li className="pl-[18px] text-xs text-text-muted">+{hiddenCount} more</li>
        )}
      </ul>
    </div>
  );
}
