// packages/ui/src/components/RefundLineRow.tsx
// Session 10 — selectable line in the RefundOrderModal. Checkbox + qty stepper.
// Disabled when the line is fully refunded or cancelled.

import type { JSX } from 'react';
import { Currency } from './Currency.js';
import { QuantityStepper } from './QuantityStepper.js';
import { cn } from '../lib/cn.js';

export interface RefundLineRowItem {
  order_item_id: string;
  name: string;
  quantity: number;
  line_total: number;
  qty_already_refunded: number;
  is_cancelled: boolean;
}

export interface RefundLineRowProps {
  item: RefundLineRowItem;
  /** Currently selected qty for this line (0 = not selected). */
  selectedQty: number;
  /** Per-IDR pre-computed amount = round_idr(line_total * selectedQty / quantity). */
  refundAmount: number;
  onChange: (qty: number) => void;
  className?: string;
}

export function RefundLineRow({
  item,
  selectedQty,
  refundAmount,
  onChange,
  className,
}: RefundLineRowProps): JSX.Element {
  const remaining = item.quantity - item.qty_already_refunded;
  const disabled = item.is_cancelled || remaining <= 0;
  const checked = selectedQty > 0;

  function handleCheck(next: boolean): void {
    if (disabled) return;
    onChange(next ? remaining : 0);
  }

  return (
    <div
      data-testid="refund-line-row"
      className={cn(
        'flex items-center justify-between gap-3 border-b border-border-subtle px-2 py-3',
        disabled && 'opacity-50',
        className,
      )}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <input
          type="checkbox"
          aria-label={`Refund line ${item.name}`}
          checked={checked}
          disabled={disabled}
          onChange={(e) => handleCheck(e.target.checked)}
          className="h-4 w-4 accent-gold"
        />
        <div className="min-w-0">
          <div className="text-sm text-text-primary truncate">{item.name}</div>
          <div className="text-[11px] uppercase tracking-wide text-text-secondary">
            qty {item.quantity}
            {item.qty_already_refunded > 0 && ` · already refunded ${item.qty_already_refunded}`}
            {item.is_cancelled && ' · cancelled'}
            {!item.is_cancelled && remaining <= 0 && ' · fully refunded'}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {checked && remaining > 1 && (
          <QuantityStepper
            value={selectedQty}
            min={1}
            max={remaining}
            onChange={(q) => onChange(q)}
          />
        )}
        <Currency
          amount={refundAmount}
          className="text-text-primary font-mono w-24 text-right"
        />
      </div>
    </div>
  );
}
