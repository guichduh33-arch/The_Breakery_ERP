// packages/ui/src/components/PromotionLineRow.tsx
//
// Session 9 — render an applied promotion as an italic-muted cart-summary row.
// Spec ref: 2026-05-10-session-9-promotions-spec.md §4.2

import type { JSX } from 'react';
import type { AppliedPromotion } from '@breakery/domain';
import { Currency } from './Currency.js';
import { cn } from '../lib/cn.js';

export interface PromotionLineRowProps {
  applied: AppliedPromotion;
  className?: string;
}

/**
 * Compact row showing `name … −Rp amount` in muted-italic style. For
 * `free_product` promos the amount is 0 (the discount manifests as a
 * unit_price=0 cart line instead) — we render "free gift" in that case
 * to make the intent visible.
 */
export function PromotionLineRow({ applied, className }: PromotionLineRowProps): JSX.Element {
  const isGift = applied.type === 'free_product';
  return (
    <div
      className={cn(
        'flex items-center justify-between text-xs italic text-text-secondary',
        className,
      )}
      data-promotion-id={applied.promotion_id}
      data-promotion-type={applied.type}
    >
      <span className="truncate pr-2">{applied.name}</span>
      {isGift ? (
        <span className="font-mono text-danger">free gift</span>
      ) : (
        <span className="font-mono text-danger">
          -<Currency amount={applied.amount} />
        </span>
      )}
    </div>
  );
}
