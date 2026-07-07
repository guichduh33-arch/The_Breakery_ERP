// apps/pos/src/features/shift/components/DenominationGrid.tsx
//
// S67 (12 D2.3) — grille de comptage par coupure IDR (open + close shift).
// Total auto en pied — la saisie remplace le montant libre quand
// business_config.shift_denomination_count_enabled est ON. Cibles 44px.

import type { JSX } from 'react';
import { Minus, Plus } from 'lucide-react';
import { IDR_DENOMINATIONS, sumDenominations } from '@breakery/domain';
import { Currency } from '@breakery/ui';

export interface DenominationGridProps {
  value:    Record<string, number>;
  onChange: (next: Record<string, number>) => void;
}

export function DenominationGrid({ value, onChange }: DenominationGridProps): JSX.Element {
  const total = sumDenominations(value);

  function setQty(face: string, qty: number): void {
    if (qty < 0 || !Number.isInteger(qty)) return;
    onChange({ ...value, [face]: qty });
  }

  return (
    <div className="space-y-1" data-testid="denomination-grid">
      <div className="max-h-[40vh] overflow-y-auto rounded-md border border-border-subtle divide-y divide-border-subtle">
        {IDR_DENOMINATIONS.map((face) => {
          const key = String(face);
          const qty = value[key] ?? 0;
          return (
            <div
              key={key}
              data-testid={`denom-row-${key}`}
              className="flex items-center justify-between gap-2 bg-bg-input px-3 py-1.5"
            >
              <span className="w-24 font-mono tabular-nums text-sm text-text-secondary">
                <Currency amount={face} />
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={`Remove one ${face}`}
                  data-testid={`denom-dec-${key}`}
                  onClick={() => { if (qty > 0) setQty(key, qty - 1); }}
                  className="h-11 w-11 grid place-items-center rounded-md border border-border-subtle text-text-secondary hover:text-text-primary hover:border-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
                >
                  <Minus className="h-4 w-4" aria-hidden />
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label={`Quantity of ${face}`}
                  data-testid={`denom-qty-${key}`}
                  value={String(qty)}
                  onChange={(e) => {
                    const n = Number(e.target.value.replace(/\D/g, '') || '0');
                    setQty(key, n);
                  }}
                  className="h-11 w-14 rounded-md border border-border-subtle bg-bg-overlay text-center font-mono tabular-nums text-sm focus:outline-none focus:border-gold"
                />
                <button
                  type="button"
                  aria-label={`Add one ${face}`}
                  data-testid={`denom-inc-${key}`}
                  onClick={() => setQty(key, qty + 1)}
                  className="h-11 w-11 grid place-items-center rounded-md border border-border-subtle text-text-secondary hover:text-text-primary hover:border-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between px-1 pt-1 text-sm">
        <span className="uppercase tracking-wide text-xs text-text-secondary">Total counted</span>
        <span className="font-mono tabular-nums text-text-primary" data-testid="denom-total">
          {total.toLocaleString('id-ID')}
        </span>
      </div>
    </div>
  );
}
