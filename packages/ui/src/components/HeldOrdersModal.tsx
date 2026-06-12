import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useState, type JSX } from 'react';
import type { HeldOrder } from '@breakery/domain';
import { cn } from '../lib/cn.js';
import { Button } from '../primitives/Button.js';
import { ScrollArea } from '../primitives/ScrollArea.js';
import { FullScreenModal } from './FullScreenModal.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../primitives/Dialog.js';

export type { HeldOrder };

export interface HeldOrderCart {
  items: { id: string; name: string; quantity: number; unit_price: number; modifiers: unknown[] }[];
  customerId: string | null;
  loyaltyPointsToRedeem: number;
  orderType: 'dine_in' | 'take_out';
  tableNumber: string | null;
}

export interface HeldOrdersModalProps {
  open: boolean;
  onClose: () => void;
  entries: HeldOrder[];
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  cartHasItems: boolean;
}

const SR_ONLY = 'absolute -m-px h-px w-px overflow-hidden whitespace-nowrap border-0 p-0';

function relativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

function HeldOrderRow({
  entry,
  onRestore,
  onDelete,
}: {
  entry: HeldOrder;
  onRestore: () => void;
  onDelete: () => void;
}): JSX.Element {
  const itemCount = entry.cart.items.reduce((sum, i) => sum + i.quantity, 0);
  const hasCustomer = entry.cart.customerId !== null;

  return (
    <div className="rounded-xl border border-border-subtle bg-bg-elevated p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary">
            {relativeTime(entry.heldAt)}
            <span className="ml-2 font-normal text-text-secondary">· {itemCount} item{itemCount !== 1 ? 's' : ''}</span>
          </p>
          {hasCustomer && (
            <p className="text-xs text-text-secondary mt-0.5">Customer attached</p>
          )}
          {entry.notes && (
            <p className="text-xs italic text-text-muted mt-0.5">{entry.notes}</p>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" size="lg" className="flex-1" onClick={onRestore}>
          Restore
        </Button>
        <Button variant="secondary" size="lg" className="flex-1 text-red hover:border-red" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </div>
  );
}

export function HeldOrdersModal({
  open,
  onClose,
  entries,
  onRestore,
  onDelete,
  cartHasItems,
}: HeldOrdersModalProps): JSX.Element {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const sorted = [...entries].sort(
    (a, b) => new Date(b.heldAt).getTime() - new Date(a.heldAt).getTime(),
  );

  function handleRestoreTap(id: string): void {
    if (cartHasItems) {
      setConfirmId(id);
    } else {
      onRestore(id);
      onClose();
    }
  }

  function handleConfirmReplace(): void {
    if (confirmId) {
      onRestore(confirmId);
      setConfirmId(null);
      onClose();
    }
  }

  function handleCancelConfirm(): void {
    setConfirmId(null);
  }

  return (
    <>
      <FullScreenModal open={open} onOpenChange={(o) => !o && onClose()} accessibleTitle="Held orders">
        <DialogPrimitive.Title asChild>
          <span className={cn(SR_ONLY)}>Held orders</span>
        </DialogPrimitive.Title>
        <DialogPrimitive.Description asChild>
          <span className={cn(SR_ONLY)}>Restore or delete a held order.</span>
        </DialogPrimitive.Description>

        <header className="h-14 px-6 flex items-center justify-between border-b border-border-subtle bg-bg-elevated">
          <div className="flex items-center gap-2">
            <h2 className="font-serif text-xl">Held orders</h2>
            <span className="text-sm text-text-secondary font-mono">({entries.length})</span>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" aria-hidden />
          </Button>
        </header>

        {entries.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
            <p className="text-text-secondary text-sm">No held orders</p>
            <Button variant="secondary" size="lg" onClick={onClose}>
              Cancel
            </Button>
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-3">
              {sorted.map((entry) => (
                <HeldOrderRow
                  key={entry.id}
                  entry={entry}
                  onRestore={() => handleRestoreTap(entry.id)}
                  onDelete={() => onDelete(entry.id)}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </FullScreenModal>

      <Dialog open={confirmId !== null} onOpenChange={(o) => !o && handleCancelConfirm()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard current cart?</DialogTitle>
            <DialogDescription>This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="lg" onClick={handleCancelConfirm}>
              Cancel
            </Button>
            <Button variant="primary" size="lg" onClick={handleConfirmReplace}>
              Replace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
