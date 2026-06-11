// apps/pos/src/features/inbox/components/TabletInboxButton.tsx
//
// Pending tablet-orders inbox. Self-contained (query + modal owned here) so
// hosts only need to render it — same pattern as HoldOrderButton /
// SendToKitchenButton. Mounted in BottomActionBar (left group); the original
// CartActionsBar slot was retired with the POS redesign.
import { useState, type JSX } from 'react';
import { TabletSmartphone } from 'lucide-react';
import { usePendingTabletOrders } from '../hooks/usePendingTabletOrders';
import { TabletInboxModal } from './TabletInboxModal';

interface TabletInboxButtonProps {
  /** Overrides the default styling (e.g. the BottomActionBar ghost style). */
  className?: string;
}

export function TabletInboxButton({ className }: TabletInboxButtonProps = {}): JSX.Element {
  const [open, setOpen] = useState(false);
  const { data: entries = [] } = usePendingTabletOrders();
  const count = entries.length;

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setOpen(true)}
        disabled={count === 0}
        data-testid="tablet-inbox-button"
      >
        <TabletSmartphone className="h-4 w-4 text-gold" aria-hidden />
        <span>Tablet</span>
        {count > 0 && (
          <span
            className="ml-0.5 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-gold text-bg-base text-[10px] font-bold"
            aria-label={`${count} pending tablet order${count === 1 ? '' : 's'}`}
          >
            {count}
          </span>
        )}
      </button>
      <TabletInboxModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
