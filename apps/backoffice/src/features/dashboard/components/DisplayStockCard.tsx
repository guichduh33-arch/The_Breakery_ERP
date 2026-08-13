// apps/backoffice/src/features/dashboard/components/DisplayStockCard.tsx
//
// Écran 1c — la vitrine : ce qu'il reste en comptoir, et depuis combien de
// temps chaque produit n'a plus bougé.
//
// Le temps depuis la dernière vente est le vrai signal. Un compteur à 9 dit
// « il en reste » ; « 9 · 52 min » dit « il en reste parce que ça ne se vend
// plus », ce qui appelle une décision (déplacer, remiser, arrêter la
// production) que le compteur seul ne déclenche jamais.
//
// Carte en LECTURE SEULE : le compteur vitrine n'est muté que par le POS. Un
// compteur à 0 y bloque la vente — d'où l'alerte en pied, qui reprend le
// libellé déjà employé côté paramétrage produit.

import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@breakery/ui';
import { DashboardCard, LiveMarker } from './DashboardCard.js';
import { formatMinutes, formatQty } from '../utils/format.js';
import type { DisplayStockPanel, DisplayStockRow } from '../hooks/useDashboardPanels.js';

function qtyTone(row: DisplayStockRow): string {
  if (row.quantity <= 0) return 'text-danger font-semibold';
  if (row.min_threshold !== null && row.quantity <= row.min_threshold) {
    return 'text-warning font-semibold';
  }
  return 'text-text-primary';
}

export function DisplayStockCard({
  panel, isLoading, isRestricted, error,
}: {
  panel: DisplayStockPanel | null;
  isLoading: boolean;
  isRestricted: boolean;
  error: Error | null;
}): JSX.Element {
  const rows  = panel?.rows ?? [];
  const empty = panel?.empty_count ?? 0;

  return (
    <DashboardCard
      title="Display stock · vitrine"
      aside={<LiveMarker />}
      subtitle="Read-only · time since the product's last sale"
      isLoading={isLoading}
      isRestricted={isRestricted}
      error={error}
      testId="card-display-stock"
      footer={
        <>
          {empty > 0 && (
            <>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-danger" aria-hidden />
              <span className="text-text-secondary">
                {empty} counter{empty > 1 ? 's' : ''} empty — POS blocks the sale
              </span>
            </>
          )}
          <Link to="/backoffice/inventory/display" className="ml-auto font-medium text-gold">
            Open vitrine
          </Link>
        </>
      }
    >
      {rows.length === 0 ? (
        <p className="py-2 text-xs text-text-muted">No product is on display.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.product_id} className="flex items-baseline gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate text-text-primary">{r.product_name}</span>
              <span className="shrink-0 font-data tabular-nums text-text-muted">
                {r.minutes_since_sale === null ? '—' : formatMinutes(r.minutes_since_sale)}
              </span>
              <span className={cn('w-14 shrink-0 whitespace-nowrap text-right font-data tabular-nums', qtyTone(r))}>
                {formatQty(r.quantity)} {r.unit}
              </span>
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}
