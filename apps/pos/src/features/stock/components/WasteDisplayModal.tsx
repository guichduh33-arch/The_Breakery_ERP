// apps/pos/src/features/stock/components/WasteDisplayModal.tsx
//
// POS display-stock isolation — modal de saisie d'une PERTE vitrine.
// Remplace le window.prompt historique. Collecte quantité + raison, puis
// délègue au callback onConfirm(qty, reason) (le parent câble waste_display_stock_v2).

import { useEffect, useRef, useState, type JSX } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { Button, CenterModal } from '@breakery/ui';
import { isDisplayQuantity } from '../quantity';

const MIN_REASON = 3;

export interface WasteDisplayModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productName: string;
  unit: string;
  /** Quantity prefilled from the card, including fractions. */
  defaultQty: number;
  isPending: boolean;
  locked?: boolean;
  onConfirm: (qty: number, reason: string) => Promise<boolean>;
}

export function WasteDisplayModal({
  open,
  onOpenChange,
  productName,
  unit,
  defaultQty,
  isPending,
  locked = false,
  onConfirm,
}: WasteDisplayModalProps): JSX.Element {
  const [qty, setQty] = useState<number | ''>((defaultQty > 0 ? defaultQty : 1));
  const [reason, setReason] = useState<string>('');
  const wasOpen = useRef(false);

  // Re-seed when (re)opened for a fresh gesture.
  useEffect(() => {
    if (open && !wasOpen.current && !locked) {
      setQty((defaultQty > 0 ? defaultQty : 1));
      setReason('');
    }
    wasOpen.current = open;
  }, [open, defaultQty, locked]);

  const reasonOk = reason.trim().length >= MIN_REASON;
  const canConfirm = qty !== '' && isDisplayQuantity(qty) && qty > 0 && reasonOk && !isPending;

  async function handleConfirm(): Promise<void> {
    if (!canConfirm) return;
    if (await onConfirm(qty, reason.trim())) onOpenChange(false);
  }

  return (
    <CenterModal
      open={open}
      onOpenChange={(next) => { if (!isPending && !locked) onOpenChange(next); }}
      title={`Display waste — ${productName}`}
      className="w-[min(440px,92vw)]"
      data-testid="waste-display-modal"
    >
      <div className="p-6 space-y-5">
        <header className="flex items-center gap-2">
          <Trash2 className="h-5 w-5 text-red-as-text" aria-hidden />
          <h2 className="font-serif text-xl">Record waste</h2>
        </header>

        <p className="text-sm text-text-secondary">
          <span className="text-text-primary font-semibold">{productName}</span> — deducts the display{' '}
          <span className="text-text-primary">and</span> inventory (a waste movement is recorded).
        </p>

        <section className="space-y-2">
          <label className="text-xs uppercase tracking-wide text-text-secondary">Wasted quantity ({unit})</label>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="Decrease"
              onClick={() => setQty((q) => Math.max(0.001, Number(q) - 1))}
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
              min={0.001}
              value={qty}
              onChange={(e) => setQty(e.target.value === '' ? '' : Number(e.target.value))}
              aria-label="Wasted quantity"
              className="h-touch-comfy flex-1 min-w-0 rounded-md border border-border-subtle bg-bg-input px-2 text-center text-lg tabular-nums focus:outline focus:outline-2 focus:outline-gold min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold placeholder:text-text-secondary"
            />
            <button
              type="button"
              aria-label="Increase"
              onClick={() => setQty((q) => Number(q) + 1)}
              disabled={isPending || locked}
              className="h-touch-comfy w-touch-comfy inline-flex items-center justify-center rounded-md border border-border-subtle hover:bg-bg-overlay disabled:opacity-50"
            >
              <Plus className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </section>

        <section className="space-y-2">
          <label htmlFor="waste_reason" className="text-xs uppercase tracking-wide text-text-secondary">
            Reason (min. {MIN_REASON} characters)
          </label>
          <input
            id="waste_reason"
            type="text"
            disabled={isPending || locked}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. end-of-day unsold, damaged…"
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
            data-testid="waste-display-confirm"
          >
            {isPending ? 'Saving…' : locked ? 'Retry same operation' : `Waste −${qty}`}
          </Button>
        </div>
      </div>
    </CenterModal>
  );
}
