// apps/pos/src/features/stock/components/POSStockCard.tsx
//
// Session 14 — Phase 2.D — Single product card in the POS cafe-stock grid.
//
// Visual refs:
//   - 70-cafe-stock-grid-all.jpg          (out-of-stock + low-stock states)
//   - 71-cafe-stock-classic-breads-filtered.jpg
//   - 72-cafe-stock-item-received-5.jpg   (inline RECEIVE button)
//
// Card states:
//   - normal     → grey border, stock number in white
//   - low_stock  → amber accent + "Low stock" banner
//   - out        → red accent + "OUT OF STOCK — sales blocked" banner
//
// Quick entry: stepper (- / +) + numeric input + +5/+10/+20 chips.
// Submits via the parent's onReceive callback. The card itself only knows
// about local pending qty and triggers the mutation upward.

import { useState, type JSX } from 'react';
import { Bell, Minus, Plus } from 'lucide-react';
import { cn, Button } from '@breakery/ui';
import type { POSStockProductRow } from '../hooks/usePOSStockProducts';

export interface POSStockCardProps {
  product: POSStockProductRow;
  isReceiving: boolean;
  onReceive: (qty: number) => void;
  /** Closure gestures (display-stock isolation). Optional — gated by display.manage upstream. */
  onReturnToKitchen?: ((qty: number) => void) | undefined;
  onWaste?: ((qty: number, reason: string) => void) | undefined;
  onAdjust?: ((newQty: number, reason: string) => void) | undefined;
}

export function POSStockCard({
  product,
  isReceiving,
  onReceive,
  onReturnToKitchen,
  onWaste,
  onAdjust,
}: POSStockCardProps): JSX.Element {
  const [qty, setQty] = useState<number>(0);

  const isOut = product.display_stock <= 0;
  const isLow =
    !isOut &&
    product.min_stock_threshold > 0 &&
    product.display_stock <= product.min_stock_threshold;

  const borderTone = isOut
    ? 'border-red/40'
    : isLow
      ? 'border-amber-warn/40'
      : 'border-border-subtle';

  const stockTextTone = isOut ? 'text-red' : isLow ? 'text-amber-warn' : 'text-text-primary';

  const handleBump = (delta: number): void => {
    setQty((q) => Math.max(0, q + delta));
  };

  const handlePreset = (preset: number): void => {
    setQty(preset);
    onReceive(preset);
    setQty(0);
  };

  const handleConfirm = (): void => {
    if (qty <= 0) return;
    onReceive(qty);
    setQty(0);
  };

  const handleReturnToKitchen = (): void => {
    if (qty <= 0 || !onReturnToKitchen) return;
    onReturnToKitchen(qty);
    setQty(0);
  };

  const handleWaste = (): void => {
    if (qty <= 0 || !onWaste) return;
    const reason = window.prompt('Raison de la perte ?')?.trim();
    if (!reason) return;
    onWaste(qty, reason);
    setQty(0);
  };

  const handleAdjust = (): void => {
    if (!onAdjust) return;
    const raw = window.prompt('Nouvelle quantité en vitrine ?', String(product.display_stock));
    if (raw === null) return;
    const next = Math.max(0, Number(raw));
    if (!Number.isFinite(next)) return;
    const reason = window.prompt('Raison de l’ajustement ? (min. 3 caractères)')?.trim();
    if (!reason) return;
    onAdjust(next, reason);
    setQty(0);
  };

  return (
    <div
      data-testid={`pos-stock-card-${product.sku}`}
      data-state={isOut ? 'out' : isLow ? 'low' : 'ok'}
      className={cn(
        'flex flex-col gap-3 rounded-lg border-2 bg-bg-elevated/60 p-4',
        borderTone,
      )}
    >
      {/* Header — image + name + sku */}
      <div className="flex items-start gap-3">
        <div
          aria-hidden
          className="h-12 w-12 shrink-0 rounded-md bg-bg-overlay overflow-hidden border border-border-subtle"
        >
          {product.image_url ? (
            <img src={product.image_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full grid place-items-center text-text-muted text-xs">
              {product.name.charAt(0)}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-text-primary truncate">{product.name}</div>
          <div className="text-[10px] uppercase tracking-widest text-text-muted">{product.sku}</div>
        </div>
        <div className={cn('font-mono text-2xl font-bold tabular-nums', stockTextTone)}>
          {product.display_stock}
        </div>
      </div>

      {/* Stock label */}
      <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-text-muted">
        <span className="inline-flex items-center gap-1">
          STOCK <Bell className="h-3 w-3" aria-hidden /> {product.min_stock_threshold}
        </span>
        <span className="text-text-secondary text-xs normal-case tracking-normal">{product.unit}</span>
      </div>

      {/* Status banner */}
      {isOut && (
        <div className="rounded-md border border-red/30 bg-red-soft px-2 py-1.5 text-xs text-red text-center inline-flex items-center justify-center gap-1">
          <Bell className="h-3 w-3" aria-hidden /> OUT OF STOCK — sales blocked
        </div>
      )}
      {isLow && (
        <div className="rounded-md border border-amber-warn/30 bg-amber-warn/10 px-2 py-1.5 text-xs text-amber-warn text-center inline-flex items-center justify-center gap-1">
          <Bell className="h-3 w-3" aria-hidden /> Low stock — restock needed (alert: {product.min_stock_threshold})
        </div>
      )}

      {/* Numpad / steppers */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label="Decrease"
          onClick={() => handleBump(-1)}
          disabled={isReceiving}
          className="h-9 w-9 inline-flex items-center justify-center rounded-md border border-border-subtle hover:bg-bg-overlay disabled:opacity-50 transition-colors"
        >
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={qty}
          onChange={(e) => setQty(Math.max(0, Number(e.target.value) || 0))}
          aria-label={`Enter quantity for ${product.name}`}
          className="h-9 flex-1 min-w-0 rounded-md border border-border-subtle bg-bg-base px-2 text-center text-sm tabular-nums focus:outline focus:outline-2 focus:outline-gold"
        />
        <button
          type="button"
          aria-label="Increase"
          onClick={() => handleBump(1)}
          disabled={isReceiving}
          className="h-9 w-9 inline-flex items-center justify-center rounded-md border border-border-subtle hover:bg-bg-overlay disabled:opacity-50 transition-colors"
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
        <PresetChip label="+5" onClick={() => handlePreset(5)} disabled={isReceiving} />
        <PresetChip label="+10" onClick={() => handlePreset(10)} disabled={isReceiving} />
        <PresetChip label="+20" onClick={() => handlePreset(20)} disabled={isReceiving} />
      </div>

      {qty > 0 ? (
        <Button variant="gold" size="sm" onClick={handleConfirm} disabled={isReceiving} className="w-full">
          Receive +{qty}
        </Button>
      ) : (
        <div className="h-9 inline-flex items-center justify-center rounded-md border border-border-subtle text-text-muted text-xs">
          Enter quantity
        </div>
      )}

      {/* Closure gestures (display-stock isolation) — only rendered when wired by the view. */}
      {(onReturnToKitchen || onWaste || onAdjust) && (
        <div className="flex items-center gap-1.5">
          {onReturnToKitchen && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleReturnToKitchen}
              disabled={isReceiving || qty <= 0}
              className="flex-1"
            >
              Retour cuisine
            </Button>
          )}
          {onWaste && (
            <Button
              variant="ghostDestructive"
              size="sm"
              onClick={handleWaste}
              disabled={isReceiving || qty <= 0}
              className="flex-1"
            >
              Perte
            </Button>
          )}
          {onAdjust && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleAdjust}
              disabled={isReceiving}
              className="flex-1"
            >
              Ajuster
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function PresetChip({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-9 px-2 inline-flex items-center justify-center rounded-md border border-border-subtle text-xs text-text-secondary hover:bg-bg-overlay hover:text-text-primary disabled:opacity-50 transition-colors"
    >
      {label}
    </button>
  );
}
