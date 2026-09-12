// apps/pos/src/features/stock/hooks/useStockQuickEntry.ts
//
// Session 72 — shared quick-entry state for the POS "Stock vitrine" surfaces
// (card + dense list row). Encapsulates the local pending qty, the derived
// out/low flags, the unit-aware quick-add increments, and the four gesture
// submitters (receive / return-to-kitchen / waste / adjust). Keeps POSStockCard
// and POSStockRow presentational and DRY.

import { useState } from 'react';
import { deriveStockIncrements } from '@breakery/domain';
import type { POSStockProductRow } from './usePOSStockProducts';

export interface StockQuickEntryCallbacks {
  onReceive?: ((qty: number) => Promise<boolean>) | undefined;
  onReturnToKitchen?: ((qty: number) => Promise<boolean>) | undefined;
  onWaste?: ((qty: number, reason: string) => Promise<boolean>) | undefined;
  onAdjust?: ((newQty: number, reason: string) => Promise<boolean>) | undefined;
}

export interface StockQuickEntry {
  qty: number;
  setQty: (v: number) => void;
  bump: (delta: number) => void;
  isOut: boolean;
  isLow: boolean;
  /** Unit-aware quick-add chips (e.g. [1,6,12] for pieces, [1,2] for a whole cake). */
  increments: number[];
  wasteOpen: boolean;
  setWasteOpen: (open: boolean) => void;
  adjustOpen: boolean;
  setAdjustOpen: (open: boolean) => void;
  /** Immediate receive of a preset increment (no confirm step). */
  submitPreset: (preset: number) => Promise<boolean>;
  submitReceive: () => Promise<boolean>;
  submitReturn: () => Promise<boolean>;
  confirmWaste: (wasteQty: number, reason: string) => Promise<boolean>;
  confirmAdjust: (newQty: number, reason: string) => Promise<boolean>;
}

export function useStockQuickEntry(
  product: POSStockProductRow,
  cb: StockQuickEntryCallbacks,
): StockQuickEntry {
  const [qty, setQtyRaw] = useState<number>(0);
  const [wasteOpen, setWasteOpen] = useState<boolean>(false);
  const [adjustOpen, setAdjustOpen] = useState<boolean>(false);

  const isOut = product.display_stock <= 0;
  const isLow =
    !isOut &&
    product.min_stock_threshold > 0 &&
    product.display_stock <= product.min_stock_threshold;

  const increments = deriveStockIncrements(product.unit, product.min_stock_threshold);

  const setQty = (v: number): void => setQtyRaw(Math.max(0, v));
  const bump = (delta: number): void => setQtyRaw((q) => Math.max(0, q + delta));

  const submitPreset = async (preset: number): Promise<boolean> => {
    if (preset <= 0 || !cb.onReceive) return false;
    const ok = await cb.onReceive(preset);
    if (ok) setQtyRaw(0);
    return ok;
  };
  const submitReceive = async (): Promise<boolean> => {
    if (qty <= 0 || !cb.onReceive) return false;
    const ok = await cb.onReceive(qty);
    if (ok) setQtyRaw(0);
    return ok;
  };
  const submitReturn = async (): Promise<boolean> => {
    if (qty <= 0 || !cb.onReturnToKitchen) return false;
    const ok = await cb.onReturnToKitchen(qty);
    if (ok) setQtyRaw(0);
    return ok;
  };
  const confirmWaste = async (wasteQty: number, reason: string): Promise<boolean> => {
    if (!cb.onWaste) return false;
    const ok = await cb.onWaste(wasteQty, reason);
    if (ok) { setQtyRaw(0); setWasteOpen(false); }
    return ok;
  };
  const confirmAdjust = async (newQty: number, reason: string): Promise<boolean> => {
    if (!cb.onAdjust) return false;
    const ok = await cb.onAdjust(newQty, reason);
    if (ok) { setQtyRaw(0); setAdjustOpen(false); }
    return ok;
  };

  return {
    qty,
    setQty,
    bump,
    isOut,
    isLow,
    increments,
    wasteOpen,
    setWasteOpen,
    adjustOpen,
    setAdjustOpen,
    submitPreset,
    submitReceive,
    submitReturn,
    confirmWaste,
    confirmAdjust,
  };
}
