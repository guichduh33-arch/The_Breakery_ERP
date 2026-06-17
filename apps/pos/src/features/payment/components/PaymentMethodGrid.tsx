// apps/pos/src/features/payment/components/PaymentMethodGrid.tsx
// Iso-behaviour extraction of PaymentTerminal's method grid.
// data-testid `pay-method-${value}` and focus-visible classes preserved.

import { SectionLabel, cn } from '@breakery/ui';
import type { PaymentMethod } from '@breakery/domain';
import { METHODS } from './paymentMethods';

export interface PaymentMethodGridProps {
  selectedMethod: PaymentMethod | null;
  onSelect: (method: PaymentMethod) => void;
}

export function PaymentMethodGrid({ selectedMethod, onSelect }: PaymentMethodGridProps) {
  return (
    <>
      <SectionLabel as="div" className="mb-2">Select Payment Method</SectionLabel>
      <div className="grid grid-cols-3 gap-3 mb-6">
        {METHODS.map((m) => {
          const Icon = m.icon;
          const active = selectedMethod === m.value;
          return (
            <button
              key={m.value}
              onClick={() => onSelect(m.value)}
              className={cn(
                'h-24 rounded-md border flex flex-col items-center justify-center gap-1.5',
                'transition-[color,background-color,border-color,transform] duration-fast ease-motion-out active:scale-[0.97] motion-reduce:active:scale-100',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold',
                active
                  ? 'border-gold bg-gold-soft text-gold'
                  : 'border-border-subtle bg-bg-elevated text-text-secondary hover:text-text-primary hover:border-gold/60',
              )}
              data-testid={`pay-method-${m.value}`}
            >
              <Icon className="h-5 w-5" aria-hidden />
              <span className="text-xs uppercase tracking-widest font-semibold">{m.label}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
