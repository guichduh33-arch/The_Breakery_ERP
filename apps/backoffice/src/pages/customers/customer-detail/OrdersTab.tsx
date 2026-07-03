// apps/backoffice/src/pages/customers/customer-detail/OrdersTab.tsx
//
// "Orders" tab of the customer detail page: recent orders table with drill-down
// links. Co-located split (S57 E-D4) — behaviour unchanged.

import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@breakery/ui';
import type { useCustomerDetail } from '@/features/customers/hooks/useCustomerDetail.js';
import { rp, StatusPill } from './shared.js';

const ORDER_TYPE_LABEL: Record<string, string> = {
  dine_in: 'Dine In',
  take_out: 'Take Out',
  delivery: 'Delivery',
  b2b: 'B2B',
};

export function OrdersTab({
  data,
}: {
  data: NonNullable<ReturnType<typeof useCustomerDetail>['data']>;
}): JSX.Element {
  const { recent_orders, orders_count } = data;
  const totalShown = recent_orders.reduce((s, o) => s + o.total, 0);

  if (recent_orders.length === 0) {
    return <Card variant="default" padding="lg"><p className="text-sm text-text-muted">No orders yet.</p></Card>;
  }

  return (
    <Card variant="default" padding="none" className="overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 text-xs text-text-secondary">
        <span>Showing {recent_orders.length} of {orders_count} orders</span>
        <span className="tabular-nums">{rp(totalShown)}</span>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead className="border-y border-border-subtle bg-bg-base/40 text-xs uppercase tracking-widest text-text-secondary">
          <tr>
            <th className="px-4 py-2.5 text-left font-medium">Date</th>
            <th className="px-4 py-2.5 text-left font-medium">Order #</th>
            <th className="px-4 py-2.5 text-left font-medium">Type</th>
            <th className="px-4 py-2.5 text-left font-medium">Status</th>
            <th className="px-4 py-2.5 text-right font-medium">Items</th>
            <th className="px-4 py-2.5 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {recent_orders.map((o) => (
            <tr key={o.id} className="border-t border-border-subtle hover:bg-bg-overlay/40">
              <td className="px-4 py-3 text-text-secondary">{new Date(o.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
              <td className="px-4 py-3 font-mono text-text-primary">
                <Link to={`/backoffice/orders/${o.id}`} className="hover:text-gold">{o.order_number}</Link>
              </td>
              <td className="px-4 py-3 text-text-secondary">{ORDER_TYPE_LABEL[o.order_type] ?? o.order_type}</td>
              <td className="px-4 py-3"><StatusPill status={o.status} /></td>
              <td className="px-4 py-3 text-right tabular-nums">{o.items_count}</td>
              <td className="px-4 py-3 text-right tabular-nums font-medium">{rp(o.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
