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
import { formatCurrency, formatPercent } from '@breakery/utils';
import type { CohortBucket } from '../hooks/useCustomerCohorts.js';

export interface CohortHeatmapProps {
  buckets: readonly CohortBucket[];
}

// Rampe de data-viz, pas d'or. Une heatmap est une SÉRIE : DESIGN.md § Data-viz
// donne `chart-1..4` aux séries et réserve les teintes `cat-*` à l'identité
// d'une catégorie de produit. L'or, lui, ne remplit jamais dans le back-office.
//
// L'ancienne rampe annonçait cinq crans et n'en rendait que trois : les trois
// autres portaient un alpha sur un token `var()` nu (`bg-gold-soft/30`,
// `bg-gold-soft/60`, `bg-gold/70`), que Tailwind supprime en silence. Les
// quatre crans de `chart-*` la remplacent, du plus clair au plus soutenu, plus
// le fond nu pour le zéro.
//
// Premiers plans mesurés sur chaque cran (thème back-office) :
//   chart-4 #c9dcea / chart-3 #8cc3e0 / chart-2 #4f93bf → `text-primary`
//     (#1a1917) : 9,2:1 sur chart-3, 5,2:1 sur chart-2, au-dessus partout.
//   chart-1 #2b6c9c → l'encre y tombe à 3,1:1 ; le cran le plus soutenu prend
//     donc l'ivoire du thème (#fffdf9), 5,6:1.
function heatColour(pct: number): string {
  if (pct <= 0)  return 'bg-bg-overlay text-text-secondary';
  if (pct < 25)  return 'bg-chart-4 text-text-primary';
  if (pct < 50)  return 'bg-chart-3 text-text-primary';
  if (pct < 75)  return 'bg-chart-2 text-text-primary';
  return 'bg-chart-1 text-ink-fg';
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
        Cohort month: <span className="text-text-primary font-medium">{cohortMonth}</span>
        {' · '}
        Cohort size: <span className="text-text-primary font-medium">{cohortSize}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse" aria-label="Cohort retention heatmap">
          <thead>
            <tr>
              <th scope="col" className="px-2 py-1 text-left font-medium text-text-secondary">Month +</th>
              {sorted.map((b) => (
                <th scope="col" key={b.months_since_signup} className="px-2 py-1 text-center font-medium text-text-secondary">
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
                  title={`${b.retained_customers} retained · ${formatCurrency(b.total_revenue)} revenue`}
                >
                  {formatPercent(b.retention_pct)}
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
                  {b.total_revenue > 0 ? formatCurrency(b.total_revenue) : '—'}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
