// apps/pos/src/features/customers/components/CustomerAttachedBadge.tsx
import { X } from 'lucide-react';
import { LoyaltyBadge } from '@breakery/ui';
import { tierFromLifetime } from '@breakery/domain';
import type { Customer } from '@breakery/domain';

interface CustomerAttachedBadgeProps {
  customer: Customer;
  onDetach: () => void;
}

export function CustomerAttachedBadge({ customer, onDetach }: CustomerAttachedBadgeProps) {
  const tier = tierFromLifetime(customer.lifetime_points);
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-bg-overlay border border-border-subtle">
      <div className="flex items-center gap-2 min-w-0">
        <LoyaltyBadge tier={tier} points={customer.loyalty_points} />
        <span className="text-sm font-medium truncate">{customer.name}</span>
      </div>
      <button
        onClick={onDetach}
        aria-label="Detach customer"
        className="text-text-secondary hover:text-text-primary transition-colors shrink-0"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
