// apps/pos/src/features/stock/components/POSStockCard.tsx
//
// Session 14 — Phase 2.D — Single product card in the POS "Stock vitrine" grid.
// Session 72 — audit fixes: 56px touch targets, unit-derived quick-add chips,
//   full FR copy, readable threshold label. Shared logic in useStockQuickEntry.
//
// Card states:
//   - normal     → grey border, stock number in white
//   - low_stock  → amber accent + "Stock bas" banner
//   - out        → red accent + "RUPTURE — vente bloquée" banner
//
// Quick entry: stepper (- / +) + numeric input + unit-aware +N chips.
// Submits via the parent's onReceive callback. The card itself only knows
// about local pending qty (via useStockQuickEntry) and triggers upward.

import { type JSX } from 'react';
import { Bell, Minus, Plus } from 'lucide-react';
import { cn, Button } from '@breakery/ui';
import type { POSStockProductRow } from '../hooks/usePOSStockProducts';
import { useStockQuickEntry } from '../hooks/useStockQuickEntry';
import { StockGestureModals } from './StockGestureModals';

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
  const entry = useStockQuickEntry(product, { onReceive, onReturnToKitchen, onWaste, onAdjust });
  const { isOut, isLow, qty, increments } = entry;

  const borderTone = isOut
    ? 'border-red/40'
    : isLow
      ? 'border-amber-warn/40'
      : 'border-border-subtle';

  const stockTextTone = isOut ? 'text-red' : isLow ? 'text-amber-warn' : 'text-text-primary';

  const hasClosure = Boolean(onReturnToKitchen ?? onWaste ?? onAdjust);

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

      {/* Threshold + unit label */}
      <div className="flex items-center justify-between text-xs text-text-secondary">
        <span className="tabular-nums">
          Alert {product.min_stock_threshold > 0 ? product.min_stock_threshold : '—'}
        </span>
        <span>{product.unit}</span>
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

      {/* Stepper row — 56px touch targets (h-touch-comfy) */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Decrease"
          onClick={() => entry.bump(-1)}
          disabled={isReceiving}
          className="h-touch-comfy w-touch-comfy shrink-0 inline-flex items-center justify-center rounded-md border border-border-subtle hover:bg-bg-overlay disabled:opacity-50 transition-colors"
        >
          <Minus className="h-5 w-5" aria-hidden />
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={qty}
          onChange={(e) => entry.setQty(Number(e.target.value) || 0)}
          aria-label={`Enter quantity for ${product.name}`}
          className="h-touch-comfy flex-1 min-w-0 rounded-md border border-border-subtle bg-bg-base px-2 text-center text-lg tabular-nums focus:outline focus:outline-2 focus:outline-gold"
        />
        <button
          type="button"
          aria-label="Increase"
          onClick={() => entry.bump(1)}
          disabled={isReceiving}
          className="h-touch-comfy w-touch-comfy shrink-0 inline-flex items-center justify-center rounded-md border border-border-subtle hover:bg-bg-overlay disabled:opacity-50 transition-colors"
        >
          <Plus className="h-5 w-5" aria-hidden />
        </button>
      </div>

      {/* Unit-aware quick-add chips — own row, 44px targets */}
      <div className="flex items-center gap-2">
        {increments.map((n) => (
          <PresetChip
            key={n}
            label={`+${n}`}
            onClick={() => entry.submitPreset(n)}
            disabled={isReceiving}
          />
        ))}
      </div>

      {qty > 0 ? (
        <Button variant="gold" size="md" onClick={entry.submitReceive} disabled={isReceiving} className="w-full">
          Receive +{qty}
        </Button>
      ) : (
        <div className="h-touch-comfy inline-flex items-center justify-center rounded-md border border-border-subtle text-text-muted text-xs">
          Enter quantity
        </div>
      )}

      {/* Closure gestures (display-stock isolation) — only rendered when wired by the view. */}
      {hasClosure && (
        <div className="flex items-center gap-2">
          {onReturnToKitchen && (
            <Button
              variant="secondary"
              size="md"
              onClick={entry.submitReturn}
              disabled={isReceiving || qty <= 0}
              className="flex-1"
            >
              Return to kitchen
            </Button>
          )}
          {onWaste && (
            <Button
              variant="ghostDestructive"
              size="md"
              onClick={() => entry.setWasteOpen(true)}
              disabled={isReceiving}
              className="flex-1"
            >
              Waste
            </Button>
          )}
          {onAdjust && (
            <Button
              variant="ghost"
              size="md"
              onClick={() => entry.setAdjustOpen(true)}
              disabled={isReceiving}
              className="flex-1"
            >
              Adjust
            </Button>
          )}
        </div>
      )}

      <StockGestureModals
        product={product}
        entry={entry}
        isPending={isReceiving}
        hasWaste={Boolean(onWaste)}
        hasAdjust={Boolean(onAdjust)}
      />
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
      className="h-11 flex-1 min-w-0 inline-flex items-center justify-center rounded-md border border-border-subtle text-sm font-semibold text-text-secondary hover:bg-bg-overlay hover:text-text-primary disabled:opacity-50 transition-colors"
    >
      {label}
    </button>
  );
}
