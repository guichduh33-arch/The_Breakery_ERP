// apps/pos/src/features/cart/CartTotals.tsx
//
// Session 14 / Phase 2.B — totals block of the Active Order panel.
//
// Refs:
//   - docs/Design/caissapp/30-cart-active-2items-dine-in-totals.jpg
//   - docs/Design/caissapp/32-cart-locked-items-after-kitchen-send.jpg
//
// The block sits at the bottom of the right column above the CTA buttons.
// Each line is a SectionLabel-style left label + mono right amount, with the
// final TOTAL row using gold emphasis and a heavier separator above it.
//
// Pure presentational. No store reads — the parent feeds the breakdown so this
// component stays trivially testable.

import type { JSX } from 'react';
import type { AppliedPromotion, Discount } from '@breakery/domain';
import { Currency, cn } from '@breakery/ui';
import { PromotionsList } from '@/features/promotions/components/PromotionsList';

export interface CartTotalsBreakdown {
  subtotal: number;
  redemption_amount: number;
  loyaltyPointsToRedeem: number;
  tax_amount: number;
  total: number;
  appliedPromotions: AppliedPromotion[];
  cartDiscount?: Discount | undefined;
}

export interface CartTotalsProps {
  breakdown: CartTotalsBreakdown;
  className?: string;
}

interface TotalsRowProps {
  label: string;
  amount: number;
  variant?: 'normal' | 'discount';
  prefix?: string;
}

function TotalsRow({ label, amount, variant = 'normal', prefix }: TotalsRowProps): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span
        className={cn(
          'font-bold uppercase tracking-widest text-[11px]',
          variant === 'discount' ? 'text-text-secondary' : 'text-text-muted',
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          'font-mono tabular-nums',
          variant === 'discount' ? 'text-red' : 'text-text-primary',
        )}
      >
        {prefix}
        <Currency amount={amount} />
      </span>
    </div>
  );
}

export function CartTotals({ breakdown, className }: CartTotalsProps): JSX.Element {
  const {
    subtotal,
    redemption_amount,
    loyaltyPointsToRedeem,
    tax_amount,
    total,
    appliedPromotions,
    cartDiscount,
  } = breakdown;

  return (
    <div className={cn('space-y-2', className)} data-testid="cart-totals">
      <TotalsRow label="Subtotal" amount={subtotal} />

      {redemption_amount > 0 && (
        <TotalsRow
          label={`Loyalty Discount (${loyaltyPointsToRedeem} pts)`}
          amount={redemption_amount}
          variant="discount"
          prefix="-"
        />
      )}

      {appliedPromotions.length > 0 && (
        <PromotionsList applied={appliedPromotions} />
      )}

      {cartDiscount && (
        <TotalsRow
          label={`Discount (${
            cartDiscount.type === 'percentage' ? `${cartDiscount.value}%` : 'fixed'
          })`}
          amount={cartDiscount.amount}
          variant="discount"
          prefix="-"
        />
      )}

      <TotalsRow label="Tax Included (10%)" amount={tax_amount} />

      <div className="pt-3 mt-1 border-t border-border-subtle flex items-baseline justify-between gap-2">
        <span className="font-bold uppercase tracking-widest text-sm text-text-primary">
          Total Amount
        </span>
        <Currency amount={total} emphasis="gold" className="text-xl font-semibold" />
      </div>
    </div>
  );
}
