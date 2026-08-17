// apps/backoffice/src/features/marketing/components/SegmentList.tsx
//
// Renders RFM segment buckets as a flat table : segment name, customer
// count, total spent, avg orders.
//
// Session 13 / Phase 6.B.

import { formatCurrency } from '@breakery/utils';
import type { SegmentBucket } from '../hooks/useCustomerSegments.js';

export interface SegmentListProps {
  segments: readonly SegmentBucket[];
}

const SEGMENT_LABELS: Record<SegmentBucket['segment'], string> = {
  champions: 'Champions',
  loyal:     'Loyal',
  new:       'New',
  at_risk:   'At Risk',
  dormant:   'Dormant',
  lost:      'Lost',
};

const SEGMENT_HINTS: Record<SegmentBucket['segment'], string> = {
  champions: 'Recent ≤14d · 5+ orders/90d · 1M+ IDR spent',
  loyal:     'Recent ≤30d · 3+ orders/90d',
  new:       'Signed up ≤30d ago · 1+ orders',
  at_risk:   'Last visit 31-60d · 3+ lifetime visits',
  dormant:   'Last visit 61-180d',
  lost:      'No visit 180d+',
};

// Un cran par segment, et SIX crans réellement distincts. L'alpha sur un token
// `var()` nu ne rendait rien (`bg-gold/30`, `bg-info/30`) et `warn` n'est pas
// une famille du preset : quatre des six pastilles n'avaient donc aucun fond.
// Une fois les tokens `-soft` posés, `at_risk` et `dormant` retombaient tous
// deux sur l'ambre — ils portent maintenant deux sémantiques d'alerte
// distinctes : l'ambre attire l'attention, le rouge signale la perte proche.
const SEGMENT_BADGES: Record<SegmentBucket['segment'], string> = {
  champions: 'bg-gold-soft text-gold',
  loyal:     'bg-gold-soft text-text-primary',
  new:       'bg-info-soft text-info',
  at_risk:   'bg-warning-soft text-warning',
  dormant:   'bg-danger-soft text-danger',
  lost:      'bg-bg-overlay text-text-secondary',
};

export function SegmentList({ segments }: SegmentListProps) {
  if (segments.length === 0) {
    return (
      <p className="text-sm text-text-secondary" role="status">
        No customer data yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-widest text-text-secondary border-b border-border-subtle">
            <th className="px-3 py-2">Segment</th>
            <th className="px-3 py-2">Definition</th>
            <th className="px-3 py-2 text-right">Customers</th>
            <th className="px-3 py-2 text-right">Total spent</th>
            <th className="px-3 py-2 text-right">Avg orders (90d)</th>
          </tr>
        </thead>
        <tbody>
          {segments.map((s) => (
            <tr key={s.segment} className="border-b border-border-subtle">
              <td className="px-3 py-3">
                <span
                  className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium ${SEGMENT_BADGES[s.segment]}`}
                >
                  {SEGMENT_LABELS[s.segment]}
                </span>
              </td>
              <td className="px-3 py-3 text-xs text-text-secondary">
                {SEGMENT_HINTS[s.segment]}
              </td>
              <td className="px-3 py-3 text-right font-mono tabular-nums">
                {s.customer_count.toLocaleString('id-ID')}
              </td>
              <td className="px-3 py-3 text-right font-mono tabular-nums">
                {formatCurrency(s.total_spent)}
              </td>
              <td className="px-3 py-3 text-right font-mono tabular-nums">
                {s.avg_orders.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
