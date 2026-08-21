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

// La distinction est portée par le LISERÉ, pas par le fond.
//
// Tous les tokens `-soft` du thème sont le même alpha 12 % sur du blanc : les
// six fonds tenaient donc dans une plage de 1,000 à 1,201:1, et `champions` /
// `loyal` étaient STRICTEMENT identiques (1,000:1, tous deux `bg-gold-soft`).
// À 12 % d'opacité la teinte est écrasée avec la luminosité — un fond soft ne
// peut pas porter une catégorie. À pleine saturation, le liseré et le texte le
// peuvent.
//
// Ce que la mesure permet, et ce qu'elle ne permet pas. Chaque liseré clôt les
// 3:1 de WCAG 1.4.11 contre la feuille blanche de la ligne — 6,22 / 5,32 /
// 5,63 / 5,91 / 5,56 / 6,06:1 — ce qui est le seuil réellement opposable : un
// objet graphique se mesure contre sa couleur ADJACENTE, la page. En revanche
// les six liserés ne sont PAS à 3:1 les uns des autres (plage 1,013→1,169:1) et
// ne peuvent pas l'être : six couleurs deux à deux à 3:1 exigeraient un écart
// de luminance de 3^5 ≈ 243:1, davantage que la plage entière du sRGB dans un
// thème clair. Ce qui les sépare est la TEINTE, pas la luminance — et le
// libellé du segment, qui reste écrit en toutes lettres, fait que la couleur
// n'est jamais le seul porteur (WCAG 1.4.1).
//
// Escalade sémantique. Elle redescendait au dernier cran : `dormant` était
// rouge et `lost` — l'état TERMINAL — un blanc neutre, ce qui se lisait comme
// une rémission. Le ton d'alarme va maintenant jusqu'au bout (`lost` en rouge)
// et `dormant` prend le gris : un client en sommeil est une ABSENCE, pas une
// alarme plus forte que `at_risk`.
const SEGMENT_BADGES: Record<SegmentBucket['segment'], string> = {
  // The Ink-Not-Gold Rule : l'or ne remplit rien ici. L'aplat retiré ne coûte
  // aucune information — le commentaire ci-dessus mesure les six fonds `-soft`
  // dans une plage de 1,000 à 1,201:1, donc indiscernables entre eux.
  champions: 'border-gold text-gold',
  loyal:     'border-success bg-success-soft text-success',
  new:       'border-info bg-info-soft text-info',
  at_risk:   'border-warning bg-warning-soft text-warning',
  dormant:   'border-text-muted bg-surface-4 text-text-secondary',
  lost:      'border-danger bg-danger-soft text-danger',
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
        <caption className="sr-only">Definition, customer count, total spent and average orders over 90 days per customer segment</caption>
        <thead>
          <tr className="text-left text-xs uppercase tracking-widest text-text-secondary border-b border-border-subtle">
            <th scope="col" className="px-3 py-2">Segment</th>
            <th scope="col" className="px-3 py-2">Definition</th>
            <th scope="col" className="px-3 py-2 text-right">Customers</th>
            <th scope="col" className="px-3 py-2 text-right">Total spent</th>
            <th scope="col" className="px-3 py-2 text-right">Avg orders (90d)</th>
          </tr>
        </thead>
        <tbody>
          {segments.map((s) => (
            <tr key={s.segment} className="border-b border-border-subtle">
              <td className="px-3 py-3">
                <span
                  className={`inline-block rounded-sm border px-2 py-0.5 text-xs font-medium ${SEGMENT_BADGES[s.segment]}`}
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
