// apps/pos/src/features/stock/components/AdjustDisplayModal.tsx
//
// POS display-stock isolation — modal de CORRECTION du comptage vitrine.
// Remplace le window.prompt historique. Saisit la nouvelle quantité absolue
// + une raison (requise ≥ 3 chars, comme adjust_display_stock_v2), puis délègue
// au callback onConfirm(newQty, reason).

import { useEffect, useRef, useState, type JSX } from 'react';
import { Minus, Plus, SlidersHorizontal } from 'lucide-react';
import { Button, CenterModal } from '@breakery/ui';
import { isDisplayQuantity } from '../quantity';

const MIN_REASON = 3;

export interface AdjustDisplayModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productName: string;
  unit: string;
  /** Quantité vitrine actuelle — sert de valeur initiale. */
  currentQty: number;
  isPending: boolean;
  locked?: boolean;
  onConfirm: (newQty: number, reason: string) => Promise<boolean>;
}

export function AdjustDisplayModal({
  open,
  onOpenChange,
  productName,
  unit,
  currentQty,
  isPending,
  locked = false,
  onConfirm,
}: AdjustDisplayModalProps): JSX.Element {
  const [newQty, setNewQty] = useState<number | ''>(Math.max(0, currentQty));
  const [reason, setReason] = useState<string>('');
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current && !locked) {
      setNewQty(Math.max(0, currentQty));
      setReason('');
    }
    wasOpen.current = open;
  }, [open, currentQty, locked]);

  const reasonOk = reason.trim().length >= MIN_REASON;
  const unchanged = newQty === currentQty;
  const canConfirm = newQty !== '' && isDisplayQuantity(newQty) && reasonOk && (!unchanged || locked) && !isPending;
  const delta = Number(newQty) - currentQty;

  async function handleConfirm(): Promise<void> {
    if (!canConfirm) return;
    if (await onConfirm(newQty, reason.trim())) onOpenChange(false);
  }

  return (
    <CenterModal
      open={open}
      onOpenChange={(next) => { if (!isPending && !locked) onOpenChange(next); }}
      title={`Adjust display — ${productName}`}
      className="w-[min(440px,92vw)]"
      data-testid="adjust-display-modal"
    >
      <div className="p-6 space-y-5">
        <header className="flex items-center gap-2">
          <SlidersHorizontal className="h-5 w-5 text-text-secondary" aria-hidden />
          <h2 className="font-serif text-xl">Correct the count</h2>
        </header>

        <p className="text-sm text-text-secondary">
          <span className="text-text-primary font-semibold">{productName}</span> — current display:{' '}
          <span className="text-text-primary tabular-nums">{currentQty}</span> {unit}. Does not affect BO inventory.
        </p>

        <section className="space-y-2">
          <label className="text-xs uppercase tracking-wide text-text-secondary">New quantity ({unit})</label>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="Decrease"
              onClick={() => setNewQty((q) => Math.max(0, Number(q) - 1))}
              disabled={isPending || locked}
              className="h-touch-comfy w-touch-comfy inline-flex items-center justify-center rounded-md border border-border-subtle hover:bg-bg-overlay disabled:opacity-50"
            >
              <Minus className="h-4 w-4" aria-hidden />
            </button>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              disabled={isPending || locked}
              min={0}
              value={newQty}
              onChange={(e) => setNewQty(e.target.value === '' ? '' : Number(e.target.value))}
              aria-label="New quantity"
              className="h-touch-comfy flex-1 min-w-0 rounded-md border border-border-subtle bg-bg-input px-2 text-center text-lg tabular-nums focus:outline focus:outline-2 focus:outline-gold min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold placeholder:text-text-secondary"
            />
            <button
              type="button"
              aria-label="Increase"
              onClick={() => setNewQty((q) => Number(q) + 1)}
              disabled={isPending || locked}
              className="h-touch-comfy w-touch-comfy inline-flex items-center justify-center rounded-md border border-border-subtle hover:bg-bg-overlay disabled:opacity-50"
            >
              <Plus className="h-4 w-4" aria-hidden />
            </button>
          </div>
          {newQty !== '' && !unchanged && (
            <p className="text-xs text-text-muted tabular-nums">
              Delta: {delta > 0 ? `+${delta}` : delta} {unit}
            </p>
          )}
        </section>

        <section className="space-y-2">
          <label htmlFor="adjust_reason" className="text-xs uppercase tracking-wide text-text-secondary">
            Reason (min. {MIN_REASON} characters)
          </label>
          <input
            id="adjust_reason"
            type="text"
            disabled={isPending || locked}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. physical recount, data-entry error…"
            className="w-full bg-bg-input border border-border-subtle rounded-md p-3 text-sm focus:outline-none focus:border-gold min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold placeholder:text-text-secondary"
          />
        </section>

        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)} disabled={isPending || locked}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="lg"
            onClick={() => { void handleConfirm(); }}
            disabled={!canConfirm}
            data-testid="adjust-display-confirm"
          >
            {isPending ? 'Saving…' : locked ? 'Retry same operation' : `Adjust to ${newQty}`}
          </Button>
        </div>
      </div>
    </CenterModal>
  );
}
