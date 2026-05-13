// apps/pos/src/features/display/components/OrderQueueTicker.tsx
//
// Session 13 / Phase 4.C.
//
// Vertical ticker of the 5 most recent paid/completed orders for the
// customer-display face screen. Each row shows the order number, a
// status pill (paid / ready / completed), and the order type (table /
// pickup).
//
// Token-only — no hardcoded hex. Semantic colors via Tailwind preset.

import type { DisplayOrder } from '../hooks/useDisplayOrders';
import { DISPLAY_ORDERS_LIMIT } from '../hooks/useDisplayOrders';

interface OrderQueueTickerProps {
  orders: DisplayOrder[];
  emptyText?: string;
}

function statusPillClasses(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-success-soft text-success';
    case 'paid':
      return 'bg-gold-soft text-gold';
    default:
      return 'bg-bg-overlay text-text-secondary';
  }
}

function orderTypeLabel(orderType: string, tableNumber: string | null): string {
  if (orderType === 'dine_in') return tableNumber ? `Table ${tableNumber}` : 'Dine-in';
  if (orderType === 'take_away') return 'Pickup';
  if (orderType === 'delivery') return 'Delivery';
  return orderType;
}

export function OrderQueueTicker({
  orders,
  emptyText = 'Awaiting orders',
}: OrderQueueTickerProps) {
  // D-4C-5 — render at most 5 rows even if the caller passes more.
  const rows = orders.slice(0, DISPLAY_ORDERS_LIMIT);

  if (rows.length === 0) {
    return (
      <div
        className="h-full flex items-center justify-center text-text-muted text-2xl font-serif italic"
        data-testid="display-queue-empty"
      >
        {emptyText}
      </div>
    );
  }

  return (
    <ul
      className="flex flex-col gap-4"
      data-testid="display-queue-list"
      aria-label="Recent orders"
    >
      {rows.map((order) => (
        <li
          key={order.id}
          className="flex items-center justify-between rounded-2xl bg-bg-elevated border border-border-subtle px-8 py-6 transition-base"
          data-testid="display-queue-row"
        >
          <div className="flex flex-col">
            <span className="text-text-muted text-sm uppercase tracking-widest">
              Order
            </span>
            <span className="text-4xl font-serif text-text-primary">
              #{order.order_number}
            </span>
          </div>

          <div className="flex flex-col items-end">
            <span
              className={`px-3 py-1 rounded-full text-xs uppercase tracking-widest font-mono ${statusPillClasses(order.status)}`}
            >
              {order.status === 'completed' ? 'Ready' : order.status}
            </span>
            <span className="text-text-secondary text-sm mt-2">
              {orderTypeLabel(order.order_type, order.table_number)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
