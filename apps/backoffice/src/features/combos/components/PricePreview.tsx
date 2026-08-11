// apps/backoffice/src/features/combos/components/PricePreview.tsx
//
// Session 47 — Live price range preview for the combo builder.
// Reads ComboDefinition built from current form state and derives
// min→max via domain priceRange().

import type { JSX } from 'react';
import { Currency } from '@breakery/ui';
import { priceRange } from '@breakery/domain';
import type { ComboDefinition } from '@breakery/domain';

interface Props {
  definition: ComboDefinition;
}

export function PricePreview({ definition }: Props): JSX.Element {
  const { min, max } = priceRange(definition);

  return (
    <div
      className="rounded-lg border border-border-gold bg-gold-soft px-4 py-3 flex items-start justify-between gap-4"
      data-testid="price-preview"
    >
      <div>
        <div className="text-xs uppercase tracking-widest text-text-secondary font-semibold">
          Price Range
        </div>
        {/* La fourchette est calculée ici, dans le navigateur, alors que le prix
            d'un combo est arbitré côté serveur par _resolve_combo_price_v1 —
            modificateurs des composants compris. Afficher la valeur sans sa
            réserve ferait passer une estimation pour un relevé. */}
        <div className="mt-0.5 text-xs text-text-muted">
          Estimate — the final price is resolved server-side at checkout.
        </div>
      </div>
      <div className="text-right shrink-0">
        {min === max ? (
          <span className="text-xl" data-testid="price-fixed">
            <Currency amount={min} emphasis="gold" />
          </span>
        ) : (
          <span className="text-xl" data-testid="price-range">
            <Currency amount={min} emphasis="gold" />
            {' – '}
            <Currency amount={max} emphasis="gold" />
          </span>
        )}
      </div>
    </div>
  );
}
