// apps/pos/src/features/cart/HeldOrdersModal.tsx
//
// Session 14 / Phase 2.B — POS-specific held-orders chooser.
//
// Ref: docs/Design/caissapp/51-held-orders-takeaway-list.jpg
//
// Sits above the existing generic `<HeldOrdersModal />` in `packages/ui` —
// that one is the older minimal list. The visual reference shows a richer
// presentation specific to the POS surface:
//
//   ┌──────────────────────────────────────────────────────────────┐
//   │ ⌚  ACTIVE ORDERS              [DINE IN (0)] [TAKEAWAY (1)] X │
//   │     manage held orders                                        │
//   │                                                                │
//   │  ┌────────────────────────────────────────────────────────┐  │
//   │  │ POS-20260429-0001   TAKEAWAY        ⌚ 01:37 PM        │  │
//   │  │ ─────────────────────────────────────────────────────  │  │
//   │  │ 1x  Americano                                Rp 35,000  │  │
//   │  │ 1x  Flat white                               Rp 45,000  │  │
//   │  │ ─────────────────────────────────────────────────────  │  │
//   │  │ TOTAL AMOUNT                                            │  │
//   │  │ Rp 80,000                  [trash]  [↻ RESTORE]         │  │
//   │  └────────────────────────────────────────────────────────┘  │
//   └──────────────────────────────────────────────────────────────┘
//
// The component is purely visual — wires through the existing
// `useHeldOrdersStore` and `useRestoreHeldOrder` hooks. No store mutation
// happens here directly.

import { Clock, RotateCcw, Trash2, X } from 'lucide-react';
import { useMemo, useState, type JSX } from 'react';
import type { HeldOrder } from '@breakery/domain';
import {
  Currency,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  SectionLabel,
  cn,
} from '@breakery/ui';
import { useCartStore } from '@/stores/cartStore';
import { useHeldOrdersStore } from '@/stores/heldOrdersStore';
import { useRestoreHeldOrder } from '@/features/heldOrders/hooks/useRestoreHeldOrder';

interface HeldOrdersModalProps {
  open: boolean;
  onClose: () => void;
}

type FilterMode = 'dine_in' | 'take_out';

const SR_ONLY = 'absolute -m-px h-px w-px overflow-hidden whitespace-nowrap border-0 p-0';

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function orderShortId(id: string): string {
  // Held order ids are uuids — show last 4 chars as a readable suffix so the
  // visual matches POS-prefixed labels in ref 51 ("POS-…-0001"). Fall back
  // to the full id when shorter than 4.
  if (id.length <= 4) return id.toUpperCase();
  return `POS-${id.slice(-4).toUpperCase()}`;
}

function HeldOrderCard({
  entry,
  onRestore,
  onDelete,
}: {
  entry: HeldOrder;
  onRestore: () => void;
  onDelete: () => void;
}): JSX.Element {
  const itemCount = entry.cart.items.reduce((s, i) => s + i.quantity, 0);
  const total = entry.cart.items.reduce(
    (s, i) => s + (i.unit_price ?? 0) * i.quantity,
    0,
  );
  const isTakeaway = entry.cart.orderType === 'take_out';

  return (
    <article
      className="rounded-xl border border-border-subtle bg-bg-elevated overflow-hidden"
      data-held-order-id={entry.id}
    >
      {/* Header strip */}
      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-sm text-gold underline underline-offset-4 decoration-gold/60">
            {orderShortId(entry.id)}
          </span>
          <span
            className={cn(
              'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest',
              isTakeaway ? 'bg-blue-info/20 text-blue-info' : 'bg-success-soft text-success',
            )}
          >
            {isTakeaway ? 'Takeaway' : 'Dine-In'}
          </span>
        </div>
        <span className="inline-flex items-center gap-1 text-xs text-text-secondary font-mono">
          <Clock className="h-3 w-3" aria-hidden />
          {formatTime(entry.heldAt)}
        </span>
      </header>

      {/* Items */}
      <ul className="px-4 py-3 space-y-1.5 max-h-48 overflow-y-auto">
        {entry.cart.items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-xs text-text-muted shrink-0">
                {item.quantity}x
              </span>
              <span className="truncate text-text-primary">{item.name}</span>
            </span>
            <Currency
              amount={(item.unit_price ?? 0) * item.quantity}
              className="text-text-secondary text-xs"
            />
          </li>
        ))}
        {itemCount === 0 && (
          <li className="text-xs italic text-text-muted">No items in this held order.</li>
        )}
      </ul>

      {/* Footer with total + actions */}
      <footer className="px-4 py-3 border-t border-border-subtle bg-bg-overlay/40 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <SectionLabel size="xs" className="text-text-muted">
            Total Amount
          </SectionLabel>
          <Currency amount={total} emphasis="gold" className="text-xl font-semibold" />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete held order ${orderShortId(entry.id)}`}
            className={cn(
              'h-10 w-10 inline-flex items-center justify-center rounded-md',
              'text-red border border-red/30 bg-red-soft hover:bg-red/20',
              'transition-colors duration-fast motion-reduce:transition-none',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
            )}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onRestore}
            className={cn(
              'h-10 px-4 inline-flex items-center justify-center gap-2 rounded-md',
              'bg-gold hover:bg-gold-hover text-bg-base font-bold uppercase tracking-widest text-xs',
              'transition-colors duration-fast motion-reduce:transition-none',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
            )}
            aria-label={`Restore held order ${orderShortId(entry.id)}`}
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            Restore
          </button>
        </div>
      </footer>
    </article>
  );
}

export function HeldOrdersModal({ open, onClose }: HeldOrdersModalProps): JSX.Element {
  const entries = useHeldOrdersStore((s) => s.entries);
  const removeEntry = useHeldOrdersStore((s) => s.remove);
  const cartHasItems = useCartStore((s) => s.cart.items.length > 0);
  const restore = useRestoreHeldOrder();

  const [filter, setFilter] = useState<FilterMode>('take_out');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const counts = useMemo(() => {
    let dineIn = 0;
    let takeOut = 0;
    for (const e of entries) {
      if (e.cart.orderType === 'dine_in') dineIn++;
      else takeOut++;
    }
    return { dineIn, takeOut };
  }, [entries]);

  const visible = useMemo(
    () =>
      [...entries]
        .filter((e) => e.cart.orderType === filter)
        .sort((a, b) => new Date(b.heldAt).getTime() - new Date(a.heldAt).getTime()),
    [entries, filter],
  );

  function handleRestoreTap(id: string): void {
    if (cartHasItems) {
      setConfirmId(id);
      return;
    }
    restore(id);
    onClose();
  }

  function handleConfirmReplace(): void {
    if (confirmId) {
      restore(confirmId);
      setConfirmId(null);
      onClose();
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-2xl p-0 gap-0 bg-bg-elevated">
          <DialogTitle asChild>
            <span className={SR_ONLY}>Active held orders</span>
          </DialogTitle>
          <DialogDescription asChild>
            <span className={SR_ONLY}>
              Restore or delete an order that was previously placed on hold.
            </span>
          </DialogDescription>

          <header className="flex items-center justify-between gap-4 px-6 py-5 border-b border-border-subtle">
            <div className="flex items-center gap-3 min-w-0">
              <Clock className="h-5 w-5 text-gold shrink-0" aria-hidden />
              <div className="min-w-0">
                <h2 className="font-display italic text-xl text-text-primary">
                  Active Orders
                </h2>
                <SectionLabel size="xs">Manage held orders</SectionLabel>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <FilterTab
                active={filter === 'dine_in'}
                onClick={() => setFilter('dine_in')}
                label="Dine In"
                count={counts.dineIn}
              />
              <FilterTab
                active={filter === 'take_out'}
                onClick={() => setFilter('take_out')}
                label="Takeaway"
                count={counts.takeOut}
              />
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className={cn(
                'h-10 w-10 inline-flex items-center justify-center rounded-md',
                'text-text-secondary hover:text-text-primary hover:bg-bg-overlay',
                'transition-colors duration-fast motion-reduce:transition-none',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
              )}
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </header>

          <div className="max-h-[60vh] overflow-y-auto px-6 py-5">
            {visible.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                <Clock className="h-12 w-12 text-text-muted opacity-50" aria-hidden />
                <SectionLabel size="sm" className="text-text-muted">
                  No {filter === 'dine_in' ? 'dine-in' : 'takeaway'} orders held
                </SectionLabel>
                <p className="text-xs text-text-muted max-w-sm">
                  Ring up an order and tap “Hold” to park it here — useful for
                  table-hopping or split flows.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {visible.map((entry) => (
                  <HeldOrderCard
                    key={entry.id}
                    entry={entry}
                    onRestore={() => handleRestoreTap(entry.id)}
                    onDelete={() => removeEntry(entry.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Replace-cart confirmation */}
      <Dialog open={confirmId !== null} onOpenChange={(o) => !o && setConfirmId(null)}>
        <DialogContent className="max-w-md">
          <DialogTitle>Discard current cart?</DialogTitle>
          <DialogDescription>
            The active cart still has items. Restoring this held order will
            replace them — this cannot be undone.
          </DialogDescription>
          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={() => setConfirmId(null)}
              className="h-10 px-4 rounded-md border border-border-subtle bg-bg-overlay text-text-primary text-sm font-semibold hover:bg-bg-input focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmReplace}
              className="h-10 px-4 rounded-md bg-gold hover:bg-gold-hover text-bg-base text-sm font-bold uppercase tracking-widest focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            >
              Replace
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FilterTab({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'h-10 px-4 inline-flex items-center justify-center gap-2 rounded-md text-xs font-bold uppercase tracking-widest',
        'transition-colors duration-fast motion-reduce:transition-none',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
        active
          ? 'bg-gold-soft text-gold border border-gold'
          : 'bg-bg-overlay text-text-secondary border border-border-subtle hover:text-text-primary',
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          'font-mono normal-case tracking-normal text-[10px] px-1.5 py-0.5 rounded-full',
          active ? 'bg-gold text-bg-base' : 'bg-bg-input text-text-muted',
        )}
      >
        {count}
      </span>
    </button>
  );
}
