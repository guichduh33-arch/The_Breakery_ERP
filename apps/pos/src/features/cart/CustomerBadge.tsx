// apps/pos/src/features/cart/CustomerBadge.tsx
//
// Session 14 / Phase 2.B — visual rebuild of the customer pill that sits inside
// the Active Order panel after a customer has been attached.
//
// Ref: docs/Design/caissapp/31-cart-takeout-customer-bronze.jpg
//
// Anatomy:
//   - Gold-outlined pill container (matches the OUTLINE-GOLD button family for
//     the empty "ADD CLIENT" CTA so attached / unattached states feel like the
//     same control swapping content).
//   - Colored avatar circle on the left, first initial inside (Inter bold).
//     Avatar color is derived from a stable hash of the customer id so each
//     customer keeps a recognizable hue across sessions (matches the green
//     "B" / blue "T" / blue "W" pattern in ref 50).
//   - Customer name (Inter semibold, primary text).
//   - Tier sub-line in tier-specific color, MAJUSCULES + tracking-widest (D5).
//     Optional points line in mono if > 0.
//   - Detach (X) on the far right, ghost icon button.
//
// Tokens only — no hardcoded hex values. Tier colors map onto:
//   bronze   → amber-warn  (var(--amber-warn))
//   silver   → text-secondary
//   gold     → gold-base
//   platinum → blue-info   (sits closest to violet in our palette w/o adding a
//                           new token; documented deviation, fix when palette
//                           grows).

import { X } from 'lucide-react';
import type { JSX } from 'react';
import { cn } from '@breakery/ui';
import { tierFromLifetime } from '@breakery/domain';
import type { LoyaltyTier } from '@breakery/domain';
import { avatarTint } from '@/features/customers/avatarTint';
import type { CustomerWithCategory } from '@/stores/cartStore';

interface CustomerBadgeProps {
  customer: CustomerWithCategory;
  onDetach: () => void;
}

const TIER_LABEL: Record<LoyaltyTier, string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
};

const TIER_TEXT: Record<LoyaltyTier, string> = {
  bronze: 'text-amber-warn',
  silver: 'text-text-secondary',
  gold: 'text-gold',
  platinum: 'text-blue-info',
};

function firstInitial(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return '?';
  return trimmed.charAt(0).toUpperCase();
}

export function CustomerBadge({ customer, onDetach }: CustomerBadgeProps): JSX.Element {
  const tier = tierFromLifetime(customer.lifetime_points);
  const tint = avatarTint(customer.id);
  const initial = firstInitial(customer.name);

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 rounded-md',
        'border border-gold bg-transparent',
      )}
      data-testid="customer-badge"
    >
      <span
        className={cn(
          'flex items-center justify-center h-9 w-9 rounded-full shrink-0',
          'text-sm font-semibold',
          tint,
        )}
        aria-hidden="true"
      >
        {initial}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text-primary truncate">
          {customer.name}
        </p>
        <p
          className={cn(
            'text-[10px] font-bold uppercase tracking-widest',
            TIER_TEXT[tier],
          )}
        >
          {TIER_LABEL[tier]}
          {customer.loyalty_points > 0 && (
            <span className="ml-2 font-mono text-text-muted normal-case tracking-normal">
              {customer.loyalty_points.toLocaleString()} pts
            </span>
          )}
        </p>
      </div>
      <button
        type="button"
        onClick={onDetach}
        aria-label="Detach customer"
        className={cn(
          'shrink-0 inline-flex items-center justify-center h-11 w-11 rounded-md',
          'text-text-secondary hover:text-text-primary hover:bg-bg-overlay',
          'transition-colors duration-fast motion-reduce:transition-none',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
        )}
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
