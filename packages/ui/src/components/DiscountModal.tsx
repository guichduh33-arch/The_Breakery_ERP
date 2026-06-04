// packages/ui/src/components/DiscountModal.tsx
//
// Full-screen modal that lets the cashier apply a manual discount to an order
// or line item. Supports percentage (%) and fixed IDR modes, requires a reason
// text of ≥ 5 chars, and triggers PinVerificationModal when the discount
// exceeds the threshold (default 10 %).
//
// Spec ref: docs/superpowers/specs/2026-05-06-session-6-discounts-multi-modifiers-loyalty-mult-spec.md §4.2, §D8

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useMemo, useState, type JSX } from 'react';
import {
  calculateDiscountAmount,
  isAboveThreshold,
  validateDiscount,
  type Discount,
} from '@breakery/domain';
import { cn } from '../lib/cn.js';
import { Button } from '../primitives/Button.js';
import { ScrollArea } from '../primitives/ScrollArea.js';
import { Currency } from './Currency.js';
import { FullScreenModal } from './FullScreenModal.js';
import { Numpad } from './Numpad.js';

const SR_ONLY = 'absolute -m-px h-px w-px overflow-hidden whitespace-nowrap border-0 p-0';

export interface DiscountModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (discount: Discount) => void;
  /** Amount that the discount applies to (items_total − redemption for cart, line_total for line-level). */
  base: number;
  /**
   * Called when the discount exceeds the threshold (> 10%).
   * Returns userId of the authorizing manager, or null if cancelled.
   */
  onRequireAuthorization: () => Promise<string | null>;
}

type DiscountType = 'percentage' | 'fixed_amount';

function buildDiscount(type: DiscountType, raw: string, reason: string, base: number): Discount {
  const value = raw === '' ? 0 : parseFloat(raw);
  const amount = calculateDiscountAmount({ type, value }, base);
  return { type, value, amount, reason };
}

export function DiscountModal({
  open,
  onClose,
  onConfirm,
  base,
  onRequireAuthorization,
}: DiscountModalProps): JSX.Element {
  const [type, setType] = useState<DiscountType>('percentage');
  const [raw, setRaw] = useState('');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleOpenChange(o: boolean): void {
    if (!o) {
      setRaw('');
      setReason('');
      setType('percentage');
      setIsSubmitting(false);
      onClose();
    }
  }

  const discount = useMemo(
    () => buildDiscount(type, raw, reason, base),
    [type, raw, reason, base],
  );

  const errors = useMemo(() => validateDiscount(discount, base), [discount, base]);
  const hasError = errors.length > 0;
  const newTotal = base - discount.amount;

  async function handleConfirm(): Promise<void> {
    if (hasError || isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (isAboveThreshold(discount.amount, base)) {
        const userId = await onRequireAuthorization();
        if (userId === null) {
          onClose();
          return;
        }
        onConfirm({ ...discount, authorized_by: userId });
      } else {
        onConfirm(discount);
      }
      handleOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  }

  const displayValue = raw === '' ? '—' : type === 'percentage' ? `${raw}%` : `${parseInt(raw, 10).toLocaleString('id-ID')} IDR`;

  return (
    <FullScreenModal open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Title asChild>
        <span className={cn(SR_ONLY)}>Apply discount</span>
      </DialogPrimitive.Title>
      <DialogPrimitive.Description asChild>
        <span className={cn(SR_ONLY)}>Enter discount type, value, and reason.</span>
      </DialogPrimitive.Description>

      <header className="h-14 px-6 flex items-center justify-between border-b border-border-subtle bg-bg-elevated">
        <h2 className="font-serif text-xl">Apply discount</h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
          <X className="h-5 w-5" aria-hidden />
        </Button>
      </header>

      <ScrollArea className="flex-1">
        <div className="p-6 space-y-6">
          {/* Type toggle — custom implementation to avoid Radix Dialog event propagation issues */}
          <div className="flex justify-center">
            <div role="tablist" className="inline-flex h-10 items-center justify-center rounded-md bg-bg-input p-1">
              {(['percentage', 'fixed_amount'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={type === t}
                  onClick={() => {
                    setType(t);
                    setRaw('');
                  }}
                  className={cn(
                    'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all',
                    type === t
                      ? 'bg-gold-soft text-gold border border-gold shadow-sm'
                      : 'text-text-secondary hover:text-text-primary',
                  )}
                >
                  {t === 'percentage' ? '%' : 'IDR'}
                </button>
              ))}
            </div>
          </div>

          {/* Value display */}
          <div className="text-center">
            <p className="text-xs uppercase tracking-widest text-text-secondary mb-1">
              {type === 'percentage' ? 'Percentage' : 'Amount (IDR)'}
            </p>
            <p
              className="font-mono text-4xl font-bold text-text-primary"
              aria-live="polite"
              data-testid="discount-value-display"
            >
              {displayValue}
            </p>
          </div>

          {/* Numpad */}
          <Numpad
            value={raw}
            onChange={setRaw}
            maxLength={type === 'percentage' ? 3 : 9}
            className="w-full max-w-xs mx-auto"
          />

          {/* Reason textarea */}
          <div className="space-y-1">
            <label htmlFor="discount-reason" className="text-xs uppercase tracking-widest text-text-secondary">
              Reason <span className="normal-case">(min 5 chars)</span>
            </label>
            <textarea
              id="discount-reason"
              data-vkp="qwerty"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why discount?"
              rows={3}
              className="w-full rounded-md bg-bg-input border border-border-subtle text-text-primary placeholder:text-text-muted p-3 text-sm resize-none focus:outline-none focus:border-gold"
            />
            <p className="text-xs text-text-secondary text-right">{reason.trim().length}/5 min</p>
          </div>

          {/* Live preview */}
          {discount.amount > 0 && (
            <div
              className="rounded-md bg-bg-elevated border border-border-subtle p-4 space-y-1 text-sm"
              aria-live="polite"
              data-testid="discount-preview"
            >
              <div className="flex justify-between text-text-secondary">
                <span>Subtotal</span>
                <Currency amount={base} />
              </div>
              <div className="flex justify-between text-red">
                <span>Discount</span>
                <span>
                  −<Currency amount={discount.amount} />
                </span>
              </div>
              <div className="flex justify-between font-semibold text-text-primary border-t border-border-subtle pt-1 mt-1">
                <span>New total</span>
                <Currency amount={newTotal} emphasis="gold" />
              </div>
            </div>
          )}

          {/* Validation errors */}
          {hasError && (
            <div className="space-y-1" role="alert">
              {errors.map((e) => (
                <p key={e.code} className="text-red text-sm">
                  {e.message}
                </p>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      <footer className="px-6 py-4 border-t border-border-subtle bg-bg-elevated flex justify-end gap-3">
        <Button variant="secondary" size="lg" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={() => void handleConfirm()}
          disabled={hasError || isSubmitting}
          aria-disabled={hasError || isSubmitting}
        >
          {isSubmitting ? 'Verifying…' : 'Confirm'}
        </Button>
      </footer>
    </FullScreenModal>
  );
}
