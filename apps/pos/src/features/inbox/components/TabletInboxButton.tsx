import { useState, type JSX } from 'react';
import { Button } from '@breakery/ui';
import { usePendingTabletOrders } from '../hooks/usePendingTabletOrders';
import { TabletInboxModal } from './TabletInboxModal';

export function TabletInboxButton(): JSX.Element {
  const [open, setOpen] = useState(false);
  const { data: entries = [] } = usePendingTabletOrders();
  const count = entries.length;

  return (
    <>
      <Button
        variant="outlineGold"
        size="sm"
        className="flex-1"
        onClick={() => setOpen(true)}
      >
        Tablet{count > 0 ? ` (${count})` : ''}
      </Button>
      <TabletInboxModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
