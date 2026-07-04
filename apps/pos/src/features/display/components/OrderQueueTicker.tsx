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
//
// Session 59 (16 D1.2) — a distinct "Ready for pickup" section fed by
// `useReadyOrders` (order_items.kitchen_status = 'ready'), rendered above
// the existing paid/completed feed. Kitchen-ready is independent of
// payment — an order can surface here with no `paid_at` at all (fired but
// not yet tendered). The two feeds never merge : the paid queue below is
// unchanged.

import type { DisplayOrder } from '../hooks/useDisplayOrders';
import { DISPLAY_ORDERS_LIMIT } from '../hooks/useDisplayOrders';
import type { ReadyOrder } from '../hooks/useReadyOrders';

interface OrderQueueTickerProps {
  orders: DisplayOrder[];
  /** Orders with at least one order_item in kitchen_status='ready'. */
  readyOrders?: ReadyOrder[];
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
  // Customer-facing "Pickup" copy for the DB enum value take_out (the V2-era
  // ghost value never reaches here — F-002 / DEV-S36-B-03).
  if (orderType === 'take_out') return 'Pickup';
  if (orderType === 'delivery') return 'Delivery';
  return orderType;
}

export function OrderQueueTicker({
  orders,
  readyOrders = [],
  emptyText = 'Awaiting orders',
}: OrderQueueTickerProps) {
  // D-4C-5 — render at most 5 rows even if the caller passes more.
  const rows = orders.slice(0, DISPLAY_ORDERS_LIMIT);

  return (
    <div className="h-full flex flex-col gap-6" data-testid="display-queue-ticker">
      {readyOrders.length > 0 && (
        <div data-testid="display-ready-section">
          <p className="text-success text-sm uppercase tracking-widest mb-2">
            Ready for pickup
          </p>
          <ul
            className="flex flex-col gap-3"
            data-testid="display-ready-list"
            aria-label="Ready for pickup"
          >
            {readyOrders.map((order) => (
              <li
                key={order.order_id}
                className="flex items-center justify-between rounded-2xl bg-success-soft border border-success/30 px-8 py-5 transition-base"
                data-testid="display-ready-row"
              >
                <span className="text-4xl font-serif text-text-primary">
                  #{order.order_number}
                </span>
                <span className="text-text-secondary text-sm">
                  {orderTypeLabel(order.order_type, order.table_number)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex-1 min-h-0">
        {rows.length === 0 ? (
          <div
            className="h-full flex items-center justify-center text-text-muted text-2xl font-serif italic"
            data-testid="display-queue-empty"
          >
            {emptyText}
          </div>
        ) : (
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
        )}
      </div>
    </div>
  );
}
