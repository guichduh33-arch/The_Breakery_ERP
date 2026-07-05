// apps/pos/src/features/cart/HeldOrdersModal.tsx
//
// Session 14 / Phase 2.B — POS-specific held-orders chooser (visual).
// Session 35 (F-003) — rewired DB-backed: the list is now multi-terminal,
// served by `useHeldOrdersQuery` (orders flagged `is_held`), restored via
// `restore_held_order_v1` and discarded via `discard_held_order_v1`. The old
// localStorage `heldOrdersStore` is retired. `useHeldOrdersRealtime` keeps the
// list live across terminals.
//
// Ref: docs/Design/caissapp/51-held-orders-takeaway-list.jpg
//
// The summary list rows carry order_number / table_number / notes / total /
// created_at only (no item breakdown — that lives server-side until restore).

import { Clock, RotateCcw, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useState, type JSX } from 'react';
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
import { useHeldOrdersQuery, type HeldOrderRow } from '@/features/heldOrders/hooks/useHeldOrdersQuery';
import { useRestoreHeldOrder } from '@/features/heldOrders/hooks/useRestoreHeldOrder';
import { useReopenHeldOrder } from '@/features/heldOrders/hooks/useReopenHeldOrder';
import { useDiscardHeldOrder } from '@/features/heldOrders/hooks/useDiscardHeldOrder';
import { useHeldOrdersRealtime } from '@/features/heldOrders/hooks/useHeldOrdersRealtime';
import { AttachTabCustomerButton } from '@/features/heldOrders/components/AttachTabCustomerButton';

interface HeldOrdersModalProps {
  open: boolean;
  onClose: () => void;
}

const SR_ONLY = 'absolute -m-px h-px w-px overflow-hidden whitespace-nowrap border-0 p-0';

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function HeldOrderCard({
  row,
  onRestore,
  onDelete,
}: {
  row: HeldOrderRow;
  onRestore: () => void;
  onDelete: () => void;
}): JSX.Element {
  return (
    <article
      className="rounded-xl border border-border-subtle bg-bg-elevated overflow-hidden"
      data-held-order-id={row.id}
    >
      {/* Header strip */}
      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2 min-w-0">
          {/* S43 P2-3 — human label instead of the raw HELD-<uuid> order_number.
              The full order_number stays in title= for support lookups. */}
          <span
            className="font-mono text-sm text-gold"
            title={row.order_number}
          >
            Held {formatTime(row.created_at)} · {row.table_number ? `Table ${row.table_number}` : 'No table'}
          </span>
          {row.table_number && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest bg-blue-info/20 text-blue-info">
              Table {row.table_number}
            </span>
          )}
          <span
            className={cn(
              'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest',
              row.status === 'pending_payment'
                ? 'bg-gold/20 text-gold'
                : 'bg-bg-overlay text-text-muted',
            )}
          >
            {row.status === 'pending_payment' ? 'Sent' : 'Draft'}
          </span>
        </div>
        <span className="inline-flex items-center gap-1 text-xs text-text-secondary font-mono">
          <Clock className="h-3 w-3" aria-hidden />
          {formatTime(row.created_at)}
        </span>
      </header>

      {/* Notes */}
      {row.notes && (
        <p className="px-4 py-2 text-sm text-text-secondary italic border-b border-border-subtle">
          {row.notes}
        </p>
      )}

      {/* Footer with total + actions */}
      <footer className="px-4 py-3 bg-bg-overlay/40 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <SectionLabel size="xs" className="text-text-muted">
            Total Amount
          </SectionLabel>
          {row.total > 0 ? (
            <Currency amount={row.total} emphasis="gold" className="text-xl font-semibold" />
          ) : (
            <span className="text-sm text-text-muted">—</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {row.status === 'pending_payment' && <AttachTabCustomerButton orderId={row.id} />}
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete held order ${row.order_number}`}
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
            aria-label={`Restore held order ${row.order_number}`}
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
  useHeldOrdersRealtime();

  const { data, isLoading } = useHeldOrdersQuery();
  const allRows = data ?? [];
  const cartHasItems = useCartStore((s) => s.cart.items.length > 0);
  // S44 P1-A — a FIRED counter order is already in the DB (pickedUpOrderId set).
  // Restoring a held order on top would append the held items to the fired order
  // at checkout (the customer would pay the union of both). It must be paid or
  // voided first.
  const pickedUpOrderId = useCartStore((s) => s.pickedUpOrderId);
  // The order currently loaded in the cart (active fired tab) is managed from the
  // cart itself — don't also list it here as restorable/discardable.
  const rows = allRows.filter((r) => r.id !== pickedUpOrderId);
  const restore = useRestoreHeldOrder();
  const reopen = useReopenHeldOrder();
  const discard = useDiscardHeldOrder();

  const [confirmRow, setConfirmRow] = useState<HeldOrderRow | null>(null);

  async function doRestore(row: HeldOrderRow): Promise<void> {
    if (row.status === 'pending_payment') {
      await reopen.mutateAsync(row.id);
    } else {
      await restore.mutateAsync(row.id);
    }
    onClose();
  }

  function handleRestoreTap(row: HeldOrderRow): void {
    if (pickedUpOrderId) {
      toast.error('Finish or void the current fired order before restoring a held one.');
      return;
    }
    if (cartHasItems) {
      setConfirmRow(row);
      return;
    }
    void doRestore(row);
  }

  function handleConfirmReplace(): void {
    if (confirmRow) {
      void doRestore(confirmRow);
      setConfirmRow(null);
    }
  }

  function handleDelete(id: string): void {
    const reason = window.prompt('Reason for discarding this held order (min 10 chars):');
    if (!reason || reason.trim().length < 10) {
      return;
    }
    void discard.mutateAsync({ orderId: id, reason: reason.trim() });
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
              Restore or discard an order that was previously placed on hold.
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
            {isLoading ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                <Clock className="h-12 w-12 text-text-muted opacity-50 animate-pulse" aria-hidden />
                <SectionLabel size="sm" className="text-text-muted">
                  Loading held orders…
                </SectionLabel>
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                <Clock className="h-12 w-12 text-text-muted opacity-50" aria-hidden />
                <SectionLabel size="sm" className="text-text-muted">
                  No orders held
                </SectionLabel>
                <p className="text-xs text-text-muted max-w-sm">
                  Ring up an order and tap “Hold” to park it here — useful for
                  table-hopping or split flows.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {rows.map((row) => (
                  <HeldOrderCard
                    key={row.id}
                    row={row}
                    onRestore={() => handleRestoreTap(row)}
                    onDelete={() => handleDelete(row.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Replace-cart confirmation */}
      <Dialog open={confirmRow !== null} onOpenChange={(o) => !o && setConfirmRow(null)}>
        <DialogContent className="max-w-md">
          <DialogTitle>Discard current cart?</DialogTitle>
          <DialogDescription>
            The active cart still has items. Restoring this held order will
            replace them — this cannot be undone.
          </DialogDescription>
          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={() => setConfirmRow(null)}
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
