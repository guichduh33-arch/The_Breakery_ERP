// apps/pos/src/features/tablet/components/TabletOrderConfirmation.tsx
//
// Ticket 3 (design audit 2026-07-07, Tablet) — reassuring order confirmation.
//
// After a successful "Send to Kitchen", the tablet lands on My Orders with a
// `justSentOrderId` router-state flag. This banner turns the previously terse
// toast into a clear, large, reassuring confirmation: a success check, big
// copy, and the resolved order number / table once the list has loaded.
// Display-only — it reads the order already fetched for the list.

import type { JSX } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { TabletOrderCardOrder } from '@breakery/ui';

export interface TabletOrderConfirmationProps {
  /** The just-sent order, resolved from the loaded list (undefined while loading). */
  order?: TabletOrderCardOrder | undefined;
}

export function TabletOrderConfirmation({ order }: TabletOrderConfirmationProps): JSX.Element {
  const orderTypeLabel =
    order?.order_type === 'take_out' ? 'Take out' : order?.order_type === 'dine_in' ? 'Dine in' : null;

  return (
    <section
      className="mb-6 rounded-xl border border-success-soft bg-success-soft p-6 text-center"
      role="status"
      aria-live="polite"
      data-testid="tablet-order-confirmation"
    >
      <CheckCircle2 className="mx-auto h-14 w-14 text-success" aria-hidden />
      <h2 className="mt-3 text-2xl font-semibold text-text-primary">Order sent to the kitchen</h2>
      <p className="mt-1 text-sm text-text-secondary">
        The kitchen has your order. You can track its progress below.
      </p>

      {order && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm">
          <span className="font-mono text-xl font-bold text-text-primary">{order.order_number}</span>
          {order.table_number && (
            <span className="font-semibold px-2 py-0.5 rounded-full bg-bg-overlay border border-border-subtle text-text-secondary">
              {order.table_number}
            </span>
          )}
          {orderTypeLabel && <span className="text-text-secondary">{orderTypeLabel}</span>}
        </div>
      )}
    </section>
  );
}
