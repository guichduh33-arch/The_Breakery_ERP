import { cn } from '@breakery/ui';
import type { B2bInvoiceRow } from '../hooks/useB2bInvoices.js';
import { settlementOf, B2B_SETTLEMENT_TONE } from '../paymentStatusMeta.js';

export function B2bOrderStatus({ order }: { order: B2bInvoiceRow }) {
  const payment = settlementOf(Number(order.outstanding), Number(order.amount_paid));
  const badge = 'inline-flex whitespace-nowrap rounded-sm px-2 py-1 text-sm font-medium';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={cn(
          badge,
          order.b2b_delivered_at ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning',
        )}
      >
        {order.b2b_delivered_at ? 'Delivered' : 'Awaiting pickup'}
      </span>
      <span className={cn(badge, B2B_SETTLEMENT_TONE[payment])}>
        {payment === 'partial' ? 'Partially paid' : payment === 'paid' ? 'Paid' : 'Unpaid'}
      </span>
    </div>
  );
}
