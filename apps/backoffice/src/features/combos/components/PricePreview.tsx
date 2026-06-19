// apps/backoffice/src/features/combos/components/PricePreview.tsx
//
// Session 47 — Live price range preview for the combo builder.
// Reads ComboDefinition built from current form state and derives
// min→max via domain priceRange().

import type { JSX } from 'react';
import { priceRange } from '@breakery/domain';
import type { ComboDefinition } from '@breakery/domain';

interface Props {
  definition: ComboDefinition;
}

const IDR = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

export function PricePreview({ definition }: Props): JSX.Element {
  const { min, max } = priceRange(definition);

  return (
    <div
      className="rounded-lg border border-gold-soft bg-gold-soft/30 px-4 py-3 flex items-center justify-between gap-4"
      data-testid="price-preview"
    >
      <div className="text-xs uppercase tracking-widest text-text-secondary font-semibold">
        Price Range
      </div>
      <div className="text-right">
        {min === max ? (
          <span className="font-display text-xl text-gold" data-testid="price-fixed">
            {IDR.format(min)}
          </span>
        ) : (
          <span className="font-display text-xl text-gold" data-testid="price-range">
            {IDR.format(min)} – {IDR.format(max)}
          </span>
        )}
      </div>
    </div>
  );
}
