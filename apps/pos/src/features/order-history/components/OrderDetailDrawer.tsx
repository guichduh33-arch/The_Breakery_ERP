// apps/pos/src/features/order-history/components/OrderDetailDrawer.tsx
//
// Session 10 — side detail panel inside OrderHistoryPanel. Shows lines + tenders
// + prior refunds. Exposes [VOID ORDER] / [REFUND LINES] CTAs (manager-PIN).

import type { JSX } from 'react';
import { Button, Currency, TenderRow, cn } from '@breakery/ui';
import type { OrderDetail } from '../hooks/useOrderDetail';
import { OrderRetryBanner } from './OrderRetryBanner';

export interface OrderDetailDrawerProps {
  order: OrderDetail;
  onVoidClick: () => void;
  onRefundClick: () => void;
}

export function OrderDetailDrawer({
  order, onVoidClick, onRefundClick,
}: OrderDetailDrawerProps): JSX.Element {
  const isVoided = order.status === 'voided';
  const remainingRefundable = order.total - order.total_refunded;

  return (
    <div
      className="flex flex-col h-full bg-bg-elevated border-l border-border-subtle"
      data-testid="order-detail-drawer"
    >
      <header className="p-4 border-b border-border-subtle">
        <div className="flex items-baseline justify-between">
          <span className="font-serif text-2xl">{order.order_number}</span>
          <span className={cn(
            'text-xs uppercase tracking-widest font-semibold',
            isVoided ? 'text-danger' : 'text-success',
          )}>
            {order.status}
          </span>
        </div>
        {order.table_number && (
          <div className="text-xs text-text-secondary mt-1">Table {order.table_number}</div>
        )}
        {order.paid_at && (
          <div className="text-xs text-text-secondary">
            Paid {new Date(order.paid_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
        {isVoided && order.void_reason && (
          <div className="mt-2 rounded-md border border-danger/30 bg-danger-soft px-2 py-1 text-xs text-danger">
            Void reason: {order.void_reason}
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {order.status === 'paid' && (
          <OrderRetryBanner orderId={order.id} status={order.status} />
        )}
        <section>
          <div className="text-xs uppercase tracking-widest text-text-secondary mb-2">Items</div>
          <ul className="space-y-1 text-sm">
            {order.items.map((it) => (
              <li
                key={it.id}
                className={cn(
                  'flex items-center justify-between',
                  it.is_cancelled && 'line-through opacity-60',
                )}
              >
                <span>
                  {it.quantity}× {it.name_snapshot}
                  {it.qty_already_refunded > 0 && (
                    <span className="text-xs text-text-secondary ml-1">
                      (refunded {it.qty_already_refunded})
                    </span>
                  )}
                </span>
                <Currency amount={it.line_total} className="font-mono" />
              </li>
            ))}
          </ul>
        </section>

        <section>
          <div className="text-xs uppercase tracking-widest text-text-secondary mb-2">Tenders</div>
          <div className="space-y-2">
            {order.payments.map((p) => (
              <TenderRow
                key={p.id}
                method={p.method}
                amount={p.amount}
              />
            ))}
          </div>
        </section>

        <section className="space-y-1 text-sm">
          <div className="flex justify-between text-text-secondary">
            <span>Total</span>
            <Currency amount={order.total} emphasis="gold" />
          </div>
          {order.total_refunded > 0 && (
            <div className="flex justify-between text-text-secondary">
              <span>Refunded</span>
              <span className="font-mono text-danger">
                -<Currency amount={order.total_refunded} className="text-danger" />
              </span>
            </div>
          )}
          <div className="flex justify-between pt-2 border-t border-border-subtle text-text-primary font-semibold">
            <span>Remaining</span>
            <Currency amount={remainingRefundable} />
          </div>
        </section>
      </div>

      <footer className="p-4 border-t border-border-subtle space-y-2">
        <Button
          variant="secondary"
          size="lg"
          className="w-full"
          onClick={onRefundClick}
          disabled={isVoided || remainingRefundable <= 0}
        >
          Refund lines
        </Button>
        <Button
          variant="ghostDestructive"
          size="lg"
          className="w-full"
          onClick={onVoidClick}
          disabled={isVoided || order.total_refunded > 0}
          title={order.total_refunded > 0 ? 'Order has prior refunds — use partial refund instead' : undefined}
        >
          Void order
        </Button>
      </footer>
    </div>
  );
}
