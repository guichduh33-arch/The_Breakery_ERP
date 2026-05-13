// apps/backoffice/src/features/marketing/components/CohortHeatmap.tsx
//
// Renders a cohort report as a single-row "heatmap" table : columns are
// month-since-signup (0..N), cells are colour-graded by retention_pct.
//
// The cohort RPC only returns rows for ONE cohort month — this component
// renders that single cohort as a row. The page wires it via a date picker.
//
// Session 13 / Phase 6.B.

import { useMemo } from 'react';
import type { CohortBucket } from '../hooks/useCustomerCohorts.js';

export interface CohortHeatmapProps {
  buckets: readonly CohortBucket[];
}

function heatColour(pct: number): string {
  // 0   -> bg-bg-overlay (cold)
  // 25  -> bg-gold-soft
  // 50  -> bg-gold
  // 75  -> bg-gold + ring
  // 100 -> bg-gold + ring-strong
  if (pct <= 0) return 'bg-bg-overlay text-text-secondary';
  if (pct < 10) return 'bg-gold-soft/30 text-text-primary';
  if (pct < 25) return 'bg-gold-soft/60 text-text-primary';
  if (pct < 50) return 'bg-gold-soft text-text-primary';
  if (pct < 75) return 'bg-gold/70 text-bg-base';
  return 'bg-gold text-bg-base';
}

export function CohortHeatmap({ buckets }: CohortHeatmapProps) {
  const cohortMonth = buckets[0]?.cohort_month ?? null;
  const cohortSize  = buckets[0]?.retained_customers ?? 0; // month 0 = signup month

  const sorted = useMemo(
    () => [...buckets].sort((a, b) => a.months_since_signup - b.months_since_signup),
    [buckets],
  );

  if (sorted.length === 0) {
    return (
      <p className="text-sm text-text-secondary" role="status">
        No data for this cohort.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-sm text-text-secondary">
        Cohort month : <span className="text-text-primary font-medium">{cohortMonth}</span>
        {' · '}
        Cohort size  : <span className="text-text-primary font-medium">{cohortSize}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse" aria-label="Cohort retention heatmap">
          <thead>
            <tr>
              <th className="px-2 py-1 text-left font-medium text-text-secondary">Month +</th>
              {sorted.map((b) => (
                <th key={b.months_since_signup} className="px-2 py-1 text-center font-medium text-text-secondary">
                  {b.months_since_signup}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className="px-2 py-1 text-left font-medium text-text-secondary">
                Retention %
              </th>
              {sorted.map((b) => (
                <td
                  key={`r-${b.months_since_signup}`}
                  className={`px-2 py-2 text-center font-mono tabular-nums ${heatColour(b.retention_pct)}`}
                  title={`${b.retained_customers} retained · ${b.total_revenue.toLocaleString()} IDR revenue`}
                >
                  {b.retention_pct.toFixed(1)}%
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row" className="px-2 py-1 text-left font-medium text-text-secondary">
                Revenue
              </th>
              {sorted.map((b) => (
                <td
                  key={`v-${b.months_since_signup}`}
                  className="px-2 py-2 text-center font-mono tabular-nums text-text-secondary"
                >
                  {b.total_revenue > 0 ? b.total_revenue.toLocaleString() : '—'}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
