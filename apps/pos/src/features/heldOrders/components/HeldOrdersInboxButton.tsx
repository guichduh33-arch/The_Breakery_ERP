import { useState } from 'react';
import { Button } from '@breakery/ui';
import { HeldOrdersModal } from '@/features/cart/HeldOrdersModal';
import { useHeldOrdersQuery } from '../hooks/useHeldOrdersQuery';

/**
 * Session 35 (F-003) — held-orders entry point with a DB-backed count badge.
 * The list + restore/discard actions live in the shared `HeldOrdersModal`.
 */
export function HeldOrdersInboxButton() {
  const [open, setOpen] = useState(false);
  const count = useHeldOrdersQuery().data?.length ?? 0;

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
      <HeldOrdersModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
