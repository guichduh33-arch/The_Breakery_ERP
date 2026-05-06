// Spec ref: docs/superpowers/specs/2026-05-06-session-7-customer-categories-combos-spec.md §4.2
import { X } from 'lucide-react';
import type { JSX } from 'react';
import { cn } from '../lib/cn.js';
import { Currency } from './Currency.js';
import { QuantityStepper } from './QuantityStepper.js';

export interface ComboComponent {
  name: string;
  quantity: number;
}

export interface ComboLineRowProps {
  comboItem: {
    id: string;
    product_id: string;
    name: string;
    sku?: string;
    quantity: number;
    unit_price: number;
    line_total: number;
  };
  components: ComboComponent[];
  onRemove?: (id: string) => void;
  onQuantityChange?: (id: string, qty: number) => void;
  isLocked?: boolean;
  className?: string;
}

export function ComboLineRow({
  comboItem,
  components,
  onRemove,
  onQuantityChange,
  isLocked = false,
  className,
}: ComboLineRowProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col px-4 py-2 border-b border-border-subtle gap-1',
        isLocked && 'opacity-60',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          {comboItem.sku != null && (
            <span className="font-mono text-xs text-text-secondary mr-1">{comboItem.sku}</span>
          )}
          <span className="text-sm font-semibold">{comboItem.name}</span>
        </div>

        <div className={cn(isLocked && 'pointer-events-none opacity-50')}>
          <QuantityStepper
            value={comboItem.quantity}
            onChange={(qty) => onQuantityChange?.(comboItem.id, qty)}
            min={1}
          />
        </div>

        <div className="w-24 text-right shrink-0">
          <Currency amount={comboItem.line_total} emphasis="gold" className="text-sm" />
        </div>

        {onRemove != null && !isLocked && (
          <button
            type="button"
            aria-label="Remove combo item"
            className="h-touch-large w-touch-large flex items-center justify-center rounded-md text-text-secondary hover:text-red shrink-0"
            onClick={() => onRemove(comboItem.id)}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      {components.length > 0 && (
        <ul className="ml-4 flex flex-col gap-0.5">
          {components.map((comp) => (
            <li
              key={`${comp.name}-${comp.quantity}`}
              className="text-xs text-text-secondary"
            >
              + {comp.quantity}× {comp.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
