// apps/pos/src/features/payment/split/PayerCountStep.tsx
//
// Session 14 / Phase 2.C — Split flow step 1 (refs 90 / 92).
//
// Centered full-bleed step asking "HOW MANY PAYERS?" with 4 large square
// tiles (2 / 3 / 4 / 5 guests). The selected count is persisted to the
// parent so revisiting the step shows the prior choice highlighted (ref 92).

import type { JSX } from 'react';
import { Users } from 'lucide-react';
import { cn } from '@breakery/ui';

const OPTIONS = [2, 3, 4, 5] as const;

export interface PayerCountStepProps {
  /** Currently selected count (null on first visit). */
  value: number | null;
  /** Called when the cashier picks a count — parent advances the step. */
  onPick: (count: number) => void;
}

export function PayerCountStep({ value, onPick }: PayerCountStepProps): JSX.Element {
  return (
    <div
      data-testid="split-payer-count"
      className="flex-1 grid place-items-center px-6 py-12"
    >
      <div className="text-center space-y-8">
        <Users className="h-12 w-12 mx-auto text-text-secondary" aria-hidden />

        <div className="space-y-2">
          <h2 className="font-display text-2xl tracking-wide text-text-primary">
            HOW MANY PAYERS?
          </h2>
          <p className="text-text-secondary text-sm">
            Each payer will be assigned specific items from the order.
          </p>
        </div>

        <div className="grid grid-cols-4 gap-4">
          {OPTIONS.map((n) => {
            const selected = value === n;
            return (
              <button
                key={n}
                type="button"
                onClick={() => onPick(n)}
                aria-pressed={selected}
                data-testid={`split-payer-count-${n}`}
                className={cn(
                  'h-24 w-24 rounded-lg border-2 flex flex-col items-center justify-center gap-1 transition-colors',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
                  selected
                    ? 'border-gold bg-gold-soft text-text-primary'
                    : 'border-border-subtle bg-bg-elevated text-text-primary hover:border-gold/60',
                )}
              >
                <span className="font-display text-3xl">{n}</span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
                  guests
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
