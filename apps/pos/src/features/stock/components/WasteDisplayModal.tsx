// apps/pos/src/features/stock/components/WasteDisplayModal.tsx
//
// POS display-stock isolation — modal de saisie d'une PERTE vitrine.
// Remplace le window.prompt historique. Collecte quantité + raison, puis
// délègue au callback onConfirm(qty, reason) (le parent câble waste_display_stock_v1).

import { useEffect, useState, type JSX } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { Button, CenterModal } from '@breakery/ui';

const MIN_REASON = 3;

export interface WasteDisplayModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productName: string;
  unit: string;
  /** Quantité pré-remplie (depuis le stepper de la carte). Min 1. */
  defaultQty: number;
  isPending: boolean;
  onConfirm: (qty: number, reason: string) => void;
}

export function WasteDisplayModal({
  open,
  onOpenChange,
  productName,
  unit,
  defaultQty,
  isPending,
  onConfirm,
}: WasteDisplayModalProps): JSX.Element {
  const [qty, setQty] = useState<number>(Math.max(1, defaultQty));
  const [reason, setReason] = useState<string>('');

  // Re-seed when (re)opened for a fresh gesture.
  useEffect(() => {
    if (open) {
      setQty(Math.max(1, defaultQty));
      setReason('');
    }
  }, [open, defaultQty]);

  const reasonOk = reason.trim().length >= MIN_REASON;
  const canConfirm = qty > 0 && reasonOk && !isPending;

  function handleConfirm(): void {
    if (!canConfirm) return;
    onConfirm(qty, reason.trim());
    onOpenChange(false);
  }

  return (
    <CenterModal
      open={open}
      onOpenChange={onOpenChange}
      title={`Display waste — ${productName}`}
      className="w-[min(440px,92vw)]"
      data-testid="waste-display-modal"
    >
      <div className="p-6 space-y-5">
        <header className="flex items-center gap-2">
          <Trash2 className="h-5 w-5 text-red" aria-hidden />
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
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              disabled={isPending}
              className="h-touch-comfy w-touch-comfy inline-flex items-center justify-center rounded-md border border-border-subtle hover:bg-bg-overlay disabled:opacity-50"
            >
              <Minus className="h-4 w-4" aria-hidden />
            </button>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={qty}
              onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
              aria-label="Wasted quantity"
              className="h-touch-comfy flex-1 min-w-0 rounded-md border border-border-subtle bg-bg-input px-2 text-center text-lg tabular-nums focus:outline focus:outline-2 focus:outline-gold"
            />
            <button
              type="button"
              aria-label="Increase"
              onClick={() => setQty((q) => q + 1)}
              disabled={isPending}
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
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. end-of-day unsold, damaged…"
            className="w-full bg-bg-input border border-border-subtle rounded-md p-3 text-sm focus:outline-none focus:border-gold"
          />
        </section>

        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="gold"
            size="lg"
            onClick={handleConfirm}
            disabled={!canConfirm}
            data-testid="waste-display-confirm"
          >
            {isPending ? 'Saving…' : `Waste −${qty}`}
          </Button>
        </div>
      </div>
    </CenterModal>
  );
}
