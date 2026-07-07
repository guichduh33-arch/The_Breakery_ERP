import { useMemo, type JSX } from 'react';
import { useLocation } from 'react-router-dom';
import { TabletOrderCard } from '@breakery/ui';
import { useMyTabletOrders } from '@/features/tablet/hooks/useMyTabletOrders';
import { useCancelTabletOrder } from '@/features/tablet/hooks/useCancelTabletOrder';
import { useTabletOrderStatusListener } from '@/features/tablet/hooks/useTabletOrderStatusListener';
import { TabletOrderConfirmation } from '@/features/tablet/components/TabletOrderConfirmation';
import type { TabletOrderCardOrder } from '@breakery/ui';

interface TabletOrdersLocationState {
  justSentOrderId?: string | null;
}

export default function TabletOrdersPage(): JSX.Element {
  const { data: orders = [], isLoading } = useMyTabletOrders();
  const cancel = useCancelTabletOrder();
  useTabletOrderStatusListener();

  const location = useLocation();
  const justSentOrderId = (location.state as TabletOrdersLocationState | null)?.justSentOrderId ?? null;
  const justSentOrder = useMemo(
    () =>
      justSentOrderId != null
        ? (orders.find((o) => o.id === justSentOrderId) as unknown as TabletOrderCardOrder | undefined)
        : undefined,
    [orders, justSentOrderId],
  );

  return (
    <div className="h-full overflow-y-auto p-6">
      {justSentOrderId != null && <TabletOrderConfirmation order={justSentOrder} />}
      <h2 className="text-xs uppercase tracking-widest font-semibold text-text-secondary mb-4">My Orders</h2>
      {isLoading && <p className="text-text-secondary text-sm">Loading…</p>}
      {!isLoading && orders.length === 0 && (
        <p className="text-text-muted text-sm">No orders yet. Go capture your first one.</p>
      )}
      <div className="grid gap-4 max-w-2xl">
        {orders.map((order) => {
          const isJustSent = order.id === justSentOrderId;
          return (
            <div key={order.id} className={isJustSent ? 'rounded-xl ring-2 ring-success' : undefined}>
              <TabletOrderCard
                order={order as unknown as TabletOrderCardOrder}
                onCancel={(id) => cancel.mutate(id)}
                isCancelling={cancel.isPending && cancel.variables === order.id}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
