// apps/pos/src/features/stock/components/StockGestureModals.tsx
//
// Session 72 — shared render of the "Perte" (waste) and "Ajuster" (adjust)
// modals, wired to a useStockQuickEntry instance. Rendered by both POSStockCard
// and POSStockRow so the gesture UX stays identical across card & list views.

import { type JSX } from 'react';
import type { POSStockProductRow } from '../hooks/usePOSStockProducts';
import type { StockQuickEntry } from '../hooks/useStockQuickEntry';
import { WasteDisplayModal } from './WasteDisplayModal';
import { AdjustDisplayModal } from './AdjustDisplayModal';

export interface StockGestureModalsProps {
  product: POSStockProductRow;
  entry: StockQuickEntry;
  isPending: boolean;
  locked: boolean;
  hasWaste: boolean;
  hasAdjust: boolean;
}

export function StockGestureModals({
  product,
  entry,
  isPending,
  locked,
  hasWaste,
  hasAdjust,
}: StockGestureModalsProps): JSX.Element {
  return (
    <>
      {hasWaste && (
        <WasteDisplayModal
          open={entry.wasteOpen}
          onOpenChange={entry.setWasteOpen}
          productName={product.name}
          unit={product.unit}
          defaultQty={entry.qty}
          isPending={isPending}
          locked={locked}
          onConfirm={entry.confirmWaste}
        />
      )}
      {hasAdjust && (
        <AdjustDisplayModal
          open={entry.adjustOpen}
          onOpenChange={entry.setAdjustOpen}
          productName={product.name}
          unit={product.unit}
          currentQty={product.display_stock}
          isPending={isPending}
          locked={locked}
          onConfirm={entry.confirmAdjust}
        />
      )}
    </>
  );
}
