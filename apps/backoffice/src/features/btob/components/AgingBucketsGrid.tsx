// apps/backoffice/src/features/btob/components/AgingBucketsGrid.tsx
//
// Lot 2 B2B (feat/b2b-payments-archetype) — la grille des tranches d'aging
// était dupliquée à l'identique entre le dashboard B2B et l'onglet Aging de
// la page Payments ; une seule source désormais. Composant de feature :
// mono-domaine, il ne monte pas dans @breakery/ui.

import type { JSX } from 'react';
import { cn } from '@breakery/ui';
import { formatCurrency } from '@breakery/utils';
import type { B2bAgingBucket } from '../hooks/useB2bDashboard.js';

interface AgingBucketsGridProps {
  buckets: readonly B2bAgingBucket[];
  /** Ton du libellé par tranche (ex. Current → text-success) ; gris sinon. */
  tones?: Record<string, string>;
}

export function AgingBucketsGrid({ buckets, tones }: AgingBucketsGridProps): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
      {buckets.map((b) => (
        <div key={b.label} className="rounded-md border border-border-subtle bg-bg-base p-3">
          <div
            className={cn(
              'font-data text-xs font-semibold uppercase tracking-widest',
              tones?.[b.label] ?? 'text-text-secondary',
            )}
          >
            {b.label}
          </div>
          <div className="mt-1 text-xs text-text-muted">{b.range}</div>
          <div className="mt-2 font-data text-lg tabular-nums text-text-primary">{formatCurrency(b.total)}</div>
          <div className="text-xs text-text-secondary">{b.count} clients</div>
        </div>
      ))}
    </div>
  );
}
