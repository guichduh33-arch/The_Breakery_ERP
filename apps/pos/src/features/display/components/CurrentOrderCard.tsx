// apps/pos/src/features/display/components/CurrentOrderCard.tsx
//
// Session 13 / Phase 4.C.
//
// Featured "now preparing" hero card highlighting the most recent order
// at the top of the queue. The card surfaces order number + type + a
// human-readable elapsed time since paid.

import type { DisplayOrder } from '../hooks/useDisplayOrders';

interface CurrentOrderCardProps {
  order: DisplayOrder | null;
}

function elapsedLabel(paidAt: string | null): string {
  if (!paidAt) return 'just now';
  const diffMs = Date.now() - Date.parse(paidAt);
  if (Number.isNaN(diffMs) || diffMs < 0) return 'just now';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 minute ago';
  return `${minutes} minutes ago`;
}

export function CurrentOrderCard({ order }: CurrentOrderCardProps) {
  if (!order) {
    return (
      <div
        className="rounded-3xl border border-border-subtle bg-bg-elevated px-12 py-10 flex items-center justify-center"
        data-testid="display-current-empty"
      >
        <p className="font-serif italic text-3xl text-text-muted">
          Welcome to The Breakery
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-3xl border border-gold-soft bg-bg-elevated px-12 py-10 shadow-lg"
      data-testid="display-current-card"
    >
      <p className="text-sm uppercase tracking-[0.3em] text-text-secondary mb-3">
        Now Serving
      </p>
      <div className="flex items-baseline justify-between gap-6">
        <h2 className="font-serif text-7xl text-gold tracking-tight">
          #{order.order_number}
        </h2>
        <div className="text-right">
          <p className="text-text-primary text-xl">
            {order.order_type === 'dine_in' && order.table_number
              ? `Table ${order.table_number}`
              : order.order_type === 'take_out'
                ? 'Pickup'
                : order.order_type}
          </p>
          <p className="text-text-muted text-sm mt-1">{elapsedLabel(order.paid_at)}</p>
        </div>
      </div>
    </div>
  );
}
