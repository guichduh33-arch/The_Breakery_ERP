import { useState } from 'react';
import { Button, HeldOrdersModal } from '@breakery/ui';
import { useCartStore } from '@/stores/cartStore';
import { useHeldOrdersStore } from '@/stores/heldOrdersStore';
import { useRestoreHeldOrder } from '../hooks/useRestoreHeldOrder';

export function HeldOrdersInboxButton() {
  const [open, setOpen] = useState(false);
  const entries = useHeldOrdersStore((s) => s.entries);
  const removeEntry = useHeldOrdersStore((s) => s.remove);
  const cartHasItems = useCartStore((s) => s.cart.items.length > 0);
  const restore = useRestoreHeldOrder();
  const count = entries.length;

  return (
    <>
      <Button
        variant="outlineGold"
        size="sm"
        className="flex-1"
        onClick={() => setOpen(true)}
        disabled={count === 0}
      >
        Held {count > 0 ? `(${count})` : ''}
      </Button>
      <HeldOrdersModal
        open={open}
        onClose={() => setOpen(false)}
        entries={entries}
        onRestore={(id) => { restore(id); setOpen(false); }}
        onDelete={removeEntry}
        cartHasItems={cartHasItems}
      />
    </>
  );
}
