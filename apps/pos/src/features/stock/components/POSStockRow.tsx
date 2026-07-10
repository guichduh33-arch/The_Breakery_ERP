// apps/pos/src/features/stock/components/POSStockRow.tsx
//
// Session 72 — dense list-row variant of POSStockCard for the POS "Stock
// vitrine" list view. Same gestures & shared quick-entry logic, laid out on a
// single 56px-tall line so a cashier can scan & recount many products at once.
// Secondary quick-add chips + closure gestures live in an inline expansion to
// keep the row dense.

import { useState, type JSX } from 'react';
import { ChevronDown, Minus, Plus } from 'lucide-react';
import { cn, Button } from '@breakery/ui';
import type { POSStockProductRow } from '../hooks/usePOSStockProducts';
import { useStockQuickEntry } from '../hooks/useStockQuickEntry';
import { StockGestureModals } from './StockGestureModals';

export interface POSStockRowProps {
  product: POSStockProductRow;
  isReceiving: boolean;
  onReceive: (qty: number) => void;
  onReturnToKitchen?: ((qty: number) => void) | undefined;
  onWaste?: ((qty: number, reason: string) => void) | undefined;
  onAdjust?: ((newQty: number, reason: string) => void) | undefined;
}

export function POSStockRow({
  product,
  isReceiving,
  onReceive,
  onReturnToKitchen,
  onWaste,
  onAdjust,
}: POSStockRowProps): JSX.Element {
  const entry = useStockQuickEntry(product, { onReceive, onReturnToKitchen, onWaste, onAdjust });
  const { isOut, isLow, qty, increments } = entry;
  const [expanded, setExpanded] = useState(false);

  const stockTextTone = isOut ? 'text-red' : isLow ? 'text-amber-warn' : 'text-text-primary';
  const leftBorder = isOut ? 'border-l-red' : isLow ? 'border-l-amber-warn' : 'border-l-transparent';
  const hasClosure = Boolean(onReturnToKitchen || onWaste || onAdjust);

  return (
    <div
      data-testid={`pos-stock-row-${product.sku}`}
      data-state={isOut ? 'out' : isLow ? 'low' : 'ok'}
      className={cn(
        'rounded-md border border-border-subtle border-l-4 bg-bg-elevated/60',
        leftBorder,
      )}
    >
      <div className="flex items-center gap-3 px-3 py-2">
        {/* Thumbnail */}
        <div
          aria-hidden
          className="h-10 w-10 shrink-0 rounded-md bg-bg-overlay overflow-hidden border border-border-subtle"
        >
          {product.image_url ? (
            <img src={product.image_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full grid place-items-center text-text-muted text-xs">
              {product.name.charAt(0)}
            </div>
          )}
        </div>

        {/* Name + sku + status */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-text-primary truncate">{product.name}</div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-text-muted">
            <span className="truncate">{product.sku}</span>
            {isOut && <span className="text-red normal-case tracking-normal">Out of stock</span>}
            {isLow && <span className="text-amber-warn normal-case tracking-normal">Low stock</span>}
          </div>
        </div>

        {/* Threshold (hidden on narrow) */}
        <span className="hidden md:inline text-xs text-text-secondary tabular-nums whitespace-nowrap">
          Alert {product.min_stock_threshold > 0 ? product.min_stock_threshold : '—'}
        </span>

        {/* Stock count */}
        <div className="w-14 text-right">
          <span className={cn('font-mono text-xl font-bold tabular-nums', stockTextTone)}>
            {product.display_stock}
          </span>
          <span className="block text-[10px] text-text-muted">{product.unit}</span>
        </div>

        {/* Stepper — 56px touch targets */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            aria-label="Decrease"
            onClick={() => entry.bump(-1)}
            disabled={isReceiving}
            className="h-touch-comfy w-touch-comfy inline-flex items-center justify-center rounded-md border border-border-subtle hover:bg-bg-overlay disabled:opacity-50 transition-colors"
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
            className="h-touch-comfy w-16 rounded-md border border-border-subtle bg-bg-base px-2 text-center text-lg tabular-nums focus:outline focus:outline-2 focus:outline-gold"
          />
          <button
            type="button"
            aria-label="Increase"
            onClick={() => entry.bump(1)}
            disabled={isReceiving}
            className="h-touch-comfy w-touch-comfy inline-flex items-center justify-center rounded-md border border-border-subtle hover:bg-bg-overlay disabled:opacity-50 transition-colors"
          >
            <Plus className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {/* Receive */}
        <Button
          variant="gold"
          size="md"
          onClick={entry.submitReceive}
          disabled={isReceiving || qty <= 0}
          className="shrink-0 whitespace-nowrap"
        >
          Receive{qty > 0 ? ` +${qty}` : ''}
        </Button>

        {/* Expand toggle for chips + closure gestures */}
        <button
          type="button"
          aria-label={expanded ? 'Collapse' : 'More actions'}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="h-touch-comfy w-touch-comfy shrink-0 inline-flex items-center justify-center rounded-md border border-border-subtle hover:bg-bg-overlay transition-colors"
        >
          <ChevronDown
            className={cn('h-5 w-5 transition-transform motion-reduce:transition-none', expanded && 'rotate-180')}
            aria-hidden
          />
        </button>
      </div>

      {/* Inline expansion — quick-add chips + closure gestures */}
      {expanded && (
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
          {increments.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => entry.submitPreset(n)}
              disabled={isReceiving}
              className="h-11 px-4 inline-flex items-center justify-center rounded-md border border-border-subtle text-sm font-semibold text-text-secondary hover:bg-bg-overlay hover:text-text-primary disabled:opacity-50 transition-colors"
            >
              +{n}
            </button>
          ))}
          <div className="flex-1" />
          {onReturnToKitchen && (
            <Button
              variant="secondary"
              size="md"
              onClick={entry.submitReturn}
              disabled={isReceiving || qty <= 0}
            >
              Return to kitchen
            </Button>
          )}
          {onWaste && (
            <Button variant="ghostDestructive" size="md" onClick={() => entry.setWasteOpen(true)} disabled={isReceiving}>
              Waste
            </Button>
          )}
          {onAdjust && (
            <Button variant="ghost" size="md" onClick={() => entry.setAdjustOpen(true)} disabled={isReceiving}>
              Adjust
            </Button>
          )}
        </div>
      )}

      {hasClosure && (
        <StockGestureModals
          product={product}
          entry={entry}
          isPending={isReceiving}
          hasWaste={Boolean(onWaste)}
          hasAdjust={Boolean(onAdjust)}
        />
      )}
    </div>
  );
}
