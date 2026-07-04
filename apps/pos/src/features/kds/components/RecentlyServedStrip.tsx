// apps/pos/src/features/kds/components/RecentlyServedStrip.tsx
//
// Session 59 (fiche 04 D1.1 #2) — compact recall strip listing orders
// served within the last 15 minutes (see `useKdsServedOrders`). Served items
// vanish from the main board grid, so this is the only surface where
// `RecallButton` is reachable — recall moves an order's served items back
// to `preparing` so a mis-served ticket can be corrected without re-ringing
// the whole order.

import { RecallButton } from './RecallButton';
import type { KdsServedOrderRow } from '../hooks/useKdsServedOrders';

interface RecentlyServedStripProps {
  orders: KdsServedOrderRow[];
}

export function RecentlyServedStrip({ orders }: RecentlyServedStripProps) {
  if (orders.length === 0) return null;

  return (
    <div
      className="flex items-center gap-2 overflow-x-auto px-6 py-2 border-b border-border-subtle bg-bg-elevated/50"
      role="group"
      aria-label="Recently served orders"
    >
      <span className="text-xs uppercase tracking-widest text-text-muted shrink-0">
        Recently served
      </span>
      {orders.map((order) => (
        <div
          key={order.order_id}
          className="flex items-center gap-2 rounded-md border border-border-subtle px-2 py-1 shrink-0"
        >
          <span className="font-mono text-sm text-gold">{order.order_number}</span>
          <RecallButton orderId={order.order_id} orderNumber={order.order_number} />
        </div>
      ))}
    </div>
  );
}
