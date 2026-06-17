// apps/pos/src/features/payment/split/ModeSelectStep.tsx
// S38 POS-15 — Split flow initial step: choose how to split.
//
// Three tiles, same style as PayerCountStep:
//   • By items   — assign specific items to each payer (original S14 flow)
//   • Equal parts — divide total equally, last payer absorbs rounding remainder
//   • Custom amounts — cashier enters a free amount per payer

import type { JSX } from 'react';
import { Layers, Equal, SlidersHorizontal } from 'lucide-react';
import { cn } from '@breakery/ui';
import type { SplitMode } from './types';

const MODES: { value: SplitMode; label: string; sub: string; Icon: typeof Layers }[] = [
  {
    value: 'items',
    label: 'By items',
    sub: 'Assign specific items to each payer',
    Icon: Layers,
  },
  {
    value: 'equal',
    label: 'Equal parts',
    sub: 'Divide the total equally among payers',
    Icon: Equal,
  },
  {
    value: 'custom',
    label: 'Custom amounts',
    sub: 'Enter a free amount per payer',
    Icon: SlidersHorizontal,
  },
];

export interface ModeSelectStepProps {
  onSelect: (mode: SplitMode) => void;
}

export function ModeSelectStep({ onSelect }: ModeSelectStepProps): JSX.Element {
  return (
    <div
      data-testid="split-mode-select"
      className="flex-1 grid place-items-center px-6 py-12"
    >
      <div className="text-center space-y-8">
        <div className="space-y-2">
          <h2 className="font-display text-2xl tracking-wide text-text-primary">
            HOW DO YOU WANT TO SPLIT?
          </h2>
          <p className="text-text-secondary text-sm">
            Choose how the total will be divided among payers.
          </p>
        </div>

        <div className="flex flex-col gap-4 items-center">
          {MODES.map(({ value, label, sub, Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => onSelect(value)}
              data-testid={`split-mode-${value}`}
              className={cn(
                'w-80 rounded-lg border-2 flex items-center gap-4 px-6 py-5 text-left',
                'transition-[border-color,background-color,transform] duration-fast ease-motion-out active:scale-[0.98] motion-reduce:active:scale-100',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
                'border-border-subtle bg-bg-elevated text-text-primary hover:border-gold/60 hover:bg-bg-overlay',
              )}
            >
              <Icon className="h-6 w-6 text-gold shrink-0" aria-hidden />
              <div>
                <div className="font-display text-base font-bold tracking-wide">{label}</div>
                <div className="text-xs text-text-secondary mt-0.5">{sub}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
