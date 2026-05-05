import type { JSX } from 'react';
import { FullScreenModal } from '@breakery/ui';
import { TabletInboxRow } from '@breakery/ui';
import { usePendingTabletOrders } from '../hooks/usePendingTabletOrders';
import { usePickupTabletOrder } from '../hooks/usePickupTabletOrder';

interface TabletInboxModalProps {
  open: boolean;
  onClose: () => void;
}

export function TabletInboxModal({ open, onClose }: TabletInboxModalProps): JSX.Element {
  const { data: entries = [], isLoading } = usePendingTabletOrders();
  const pickup = usePickupTabletOrder(onClose);

  return (
    <FullScreenModal open={open} onOpenChange={(v) => !v && onClose()}>
      <div className="m-auto bg-bg-overlay rounded-xl p-6 max-w-2xl w-full shadow-modal max-h-[80vh] flex flex-col">
        <h2 className="font-serif text-2xl mb-4">Tablet Orders</h2>
        {isLoading && (
          <p className="text-text-secondary text-sm">Loading…</p>
        )}
        {!isLoading && entries.length === 0 && (
          <p className="text-text-muted text-sm">No pending tablet orders.</p>
        )}
        <div className="overflow-y-auto flex flex-col gap-3">
          {entries.map((entry) => (
            <TabletInboxRow
              key={entry.id}
              entry={entry}
              onPickup={(id) => pickup.mutate(id)}
              isPicking={pickup.isPending && pickup.variables === entry.id}
            />
          ))}
        </div>
      </div>
    </FullScreenModal>
  );
}
