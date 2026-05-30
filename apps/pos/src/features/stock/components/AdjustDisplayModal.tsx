// apps/pos/src/features/stock/components/AdjustDisplayModal.tsx
//
// POS display-stock isolation — modal de CORRECTION du comptage vitrine.
// Remplace le window.prompt historique. Saisit la nouvelle quantité absolue
// + une raison (requise ≥ 3 chars, comme adjust_display_stock_v1), puis délègue
// au callback onConfirm(newQty, reason).

import { useEffect, useState, type JSX } from 'react';
import { Minus, Plus, SlidersHorizontal } from 'lucide-react';
import { Button, CenterModal } from '@breakery/ui';

const MIN_REASON = 3;

export interface AdjustDisplayModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productName: string;
  unit: string;
  /** Quantité vitrine actuelle — sert de valeur initiale. */
  currentQty: number;
  isPending: boolean;
  onConfirm: (newQty: number, reason: string) => void;
}

export function AdjustDisplayModal({
  open,
  onOpenChange,
  productName,
  unit,
  currentQty,
  isPending,
  onConfirm,
}: AdjustDisplayModalProps): JSX.Element {
  const [newQty, setNewQty] = useState<number>(Math.max(0, currentQty));
  const [reason, setReason] = useState<string>('');

  useEffect(() => {
    if (open) {
      setNewQty(Math.max(0, currentQty));
      setReason('');
    }
  }, [open, currentQty]);

  const reasonOk = reason.trim().length >= MIN_REASON;
  const unchanged = newQty === currentQty;
  const canConfirm = newQty >= 0 && reasonOk && !unchanged && !isPending;
  const delta = newQty - currentQty;

  function handleConfirm(): void {
    if (!canConfirm) return;
    onConfirm(newQty, reason.trim());
    onOpenChange(false);
  }

  return (
    <CenterModal
      open={open}
      onOpenChange={onOpenChange}
      title={`Ajuster la vitrine — ${productName}`}
      className="w-[min(440px,92vw)]"
      data-testid="adjust-display-modal"
    >
      <div className="p-6 space-y-5">
        <header className="flex items-center gap-2">
          <SlidersHorizontal className="h-5 w-5 text-gold" aria-hidden />
          <h2 className="font-serif text-xl">Corriger le comptage</h2>
        </header>

        <p className="text-sm text-text-secondary">
          <span className="text-text-primary font-semibold">{productName}</span> — vitrine actuelle :{' '}
          <span className="text-text-primary tabular-nums">{currentQty}</span> {unit}. N’affecte pas l’inventaire BO.
        </p>

        <section className="space-y-2">
          <label className="text-xs uppercase tracking-wide text-text-secondary">Nouvelle quantité ({unit})</label>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="Decrease"
              onClick={() => setNewQty((q) => Math.max(0, q - 1))}
              disabled={isPending}
              className="h-touch-comfy w-touch-comfy inline-flex items-center justify-center rounded-md border border-border-subtle hover:bg-bg-overlay disabled:opacity-50"
            >
              <Minus className="h-4 w-4" aria-hidden />
            </button>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={newQty}
              onChange={(e) => setNewQty(Math.max(0, Number(e.target.value) || 0))}
              aria-label="Nouvelle quantité"
              className="h-touch-comfy flex-1 min-w-0 rounded-md border border-border-subtle bg-bg-input px-2 text-center text-lg tabular-nums focus:outline focus:outline-2 focus:outline-gold"
            />
            <button
              type="button"
              aria-label="Increase"
              onClick={() => setNewQty((q) => q + 1)}
              disabled={isPending}
              className="h-touch-comfy w-touch-comfy inline-flex items-center justify-center rounded-md border border-border-subtle hover:bg-bg-overlay disabled:opacity-50"
            >
              <Plus className="h-4 w-4" aria-hidden />
            </button>
          </div>
          {!unchanged && (
            <p className="text-xs text-text-muted tabular-nums">
              Écart : {delta > 0 ? `+${delta}` : delta} {unit}
            </p>
          )}
        </section>

        <section className="space-y-2">
          <label htmlFor="adjust_reason" className="text-xs uppercase tracking-wide text-text-secondary">
            Raison (min. {MIN_REASON} caractères)
          </label>
          <input
            id="adjust_reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex. recomptage physique, erreur de saisie…"
            className="w-full bg-bg-input border border-border-subtle rounded-md p-3 text-sm focus:outline-none focus:border-gold"
          />
        </section>

        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)} disabled={isPending}>
            Annuler
          </Button>
          <Button
            variant="gold"
            size="lg"
            onClick={handleConfirm}
            disabled={!canConfirm}
            data-testid="adjust-display-confirm"
          >
            {isPending ? 'Enregistrement…' : `Ajuster à ${newQty}`}
          </Button>
        </div>
      </div>
    </CenterModal>
  );
}
