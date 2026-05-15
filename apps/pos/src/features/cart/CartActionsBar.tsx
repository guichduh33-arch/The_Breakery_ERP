// apps/pos/src/features/cart/CartActionsBar.tsx
//
// Session 14 / Phase 2.B — secondary actions row above the cart list.
//
// Refs:
//   - docs/Design/caissapp/30-cart-active-2items-dine-in-totals.jpg (HELD
//     ORDERS / CLEAR pair)
//   - docs/Design/caissapp/31-cart-takeout-customer-bronze.jpg (same pair
//     on the take-out variant)
//
// Layout: a 2-column grid where:
//   - "Held Orders" is the gold-outline CTA that opens the held-orders modal.
//     Shows the held count as a small badge appended to the label.
//   - "Clear" is the ghost-destructive CTA that wipes unlocked items.
//
// Tablet inbox button is folded into the same row when there are pending
// tablet orders so the cashier sees both queues in one place (matches
// 05-grid-coffee-takeout-held-orders.jpg).

import { Clock, Trash2 } from 'lucide-react';
import type { JSX, ReactNode } from 'react';
import { Button, cn } from '@breakery/ui';

interface CartActionsBarProps {
  heldCount: number;
  onOpenHeldOrders: () => void;
  onClear: () => void;
  canClear: boolean;
  /**
   * Optional slot for the tablet-orders button so the parent can hand in a
   * pre-wired component without dragging that hook into this presentational
   * row.
   */
  tabletInboxSlot?: ReactNode;
  className?: string;
}

export function CartActionsBar({
  heldCount,
  onOpenHeldOrders,
  onClear,
  canClear,
  tabletInboxSlot,
  className,
}: CartActionsBarProps): JSX.Element {
  return (
    <div className={cn('grid grid-cols-2 gap-2', className)} data-testid="cart-actions-bar">
      <Button
        variant="outlineGold"
        size="md"
        className="w-full gap-2"
        onClick={onOpenHeldOrders}
        disabled={heldCount === 0}
      >
        <Clock className="h-4 w-4" aria-hidden />
        <span>Held Orders</span>
        {heldCount > 0 && (
          <span
            className="ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-gold text-bg-base text-[10px] font-bold"
            aria-label={`${heldCount} held order${heldCount === 1 ? '' : 's'}`}
          >
            {heldCount}
          </span>
        )}
      </Button>
      <Button
        variant="secondary"
        size="md"
        className="w-full gap-2"
        onClick={onClear}
        disabled={!canClear}
        title={!canClear ? 'No unlocked items to clear' : undefined}
      >
        <Trash2 className="h-4 w-4" aria-hidden />
        <span>Clear</span>
      </Button>
      {tabletInboxSlot && (
        <div className="col-span-2">{tabletInboxSlot}</div>
      )}
    </div>
  );
}
