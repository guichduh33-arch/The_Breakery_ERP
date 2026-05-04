import type { OrderType } from '@breakery/domain';
import type { JSX } from 'react';
import { cn } from '../lib/cn.js';

const TYPES: { value: OrderType; label: string }[] = [
  { value: 'dine_in', label: 'Dine In' },
  { value: 'take_out', label: 'Take-Out' },
  { value: 'delivery', label: 'Delivery' },
];

export interface OrderTypeTabsProps {
  value: OrderType;
  onChange: (next: OrderType) => void;
}

export function OrderTypeTabs({ value, onChange }: OrderTypeTabsProps): JSX.Element {
  return (
    <div role="tablist" className="grid grid-cols-3 gap-1 p-1 bg-bg-input rounded-md">
      {TYPES.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            'h-10 rounded-sm uppercase text-xs tracking-wide font-semibold transition-colors',
            value === t.value
              ? 'bg-gold-soft text-gold border border-gold'
              : 'text-text-secondary hover:text-text-primary',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
