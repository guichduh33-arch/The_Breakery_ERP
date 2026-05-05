import type { JSX } from 'react';
import { TabletOrderCard } from '@breakery/ui';
import { useMyTabletOrders } from '@/features/tablet/hooks/useMyTabletOrders';
import { useCancelTabletOrder } from '@/features/tablet/hooks/useCancelTabletOrder';
import { useTabletOrderStatusListener } from '@/features/tablet/hooks/useTabletOrderStatusListener';
import type { TabletOrderCardOrder } from '@breakery/ui';

export default function TabletOrdersPage(): JSX.Element {
  const { data: orders = [], isLoading } = useMyTabletOrders();
  const cancel = useCancelTabletOrder();
  useTabletOrderStatusListener();

  return (
    <div className="h-full overflow-y-auto p-6">
      <h2 className="text-xs uppercase tracking-widest font-semibold text-text-secondary mb-4">My Orders</h2>
      {isLoading && <p className="text-text-secondary text-sm">Loading…</p>}
      {!isLoading && orders.length === 0 && (
        <p className="text-text-muted text-sm">No orders yet. Go capture your first one.</p>
      )}
      <div className="grid gap-4 max-w-2xl">
        {orders.map((order) => (
          <TabletOrderCard
            key={order.id}
            order={order as unknown as TabletOrderCardOrder}
            onCancel={(id) => cancel.mutate(id)}
            isCancelling={cancel.isPending && cancel.variables === order.id}
          />
        ))}
      </div>
    </div>
  );
}
