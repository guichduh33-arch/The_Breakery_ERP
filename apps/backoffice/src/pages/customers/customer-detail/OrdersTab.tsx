// apps/backoffice/src/pages/customers/customer-detail/OrdersTab.tsx
//
// "Orders" tab of the customer detail page: recent orders table with drill-down
// links. Co-located split (S57 E-D4) — behaviour unchanged.

import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@breakery/ui';
import { formatDate } from '@breakery/utils';
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
    <Card variant="default" padding="none" className="overflow-x-auto">
      <div className="flex items-center justify-between px-4 py-3 text-xs text-text-secondary">
        <span>Showing {recent_orders.length} of {orders_count} orders</span>
        <span className="tabular-nums">{rp(totalShown)}</span>
      </div>
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Date, order number, type, status, item count and total per recent order</caption>
        <thead className="border-y border-border-subtle bg-surface-inert font-data text-xs font-semibold uppercase tracking-widest text-text-muted">
          <tr>
            <th scope="col" className="px-4 py-2.5 text-left font-medium">Date</th>
            <th scope="col" className="px-4 py-2.5 text-left font-medium">Order #</th>
            <th scope="col" className="px-4 py-2.5 text-left font-medium">Type</th>
            <th scope="col" className="px-4 py-2.5 text-left font-medium">Status</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">Items</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {recent_orders.map((o) => (
            <tr key={o.id} className="border-t border-border-subtle hover:bg-surface-4">
              <td className="px-4 py-3 text-text-secondary">{formatDate(o.created_at)}</td>
              <td className="px-4 py-3 font-data text-text-primary">
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
