// apps/pos/src/features/discounts/hooks/useApplyLineDiscount.ts
import { useState } from 'react';
import type { CartItem, Discount } from '@breakery/domain';
import { lineTotalOf } from '@breakery/domain';
import { useCartStore } from '@/stores/cartStore';
import { useVerifyManagerPin } from './useVerifyManagerPin';

export interface ApplyLineDiscountState {
  targetItem: CartItem | null;
  pinModalOpen: boolean;
  openForItem: (item: CartItem) => void;
  closeDiscountModal: () => void;
  onConfirm: (d: Discount) => void;
  onRequireAuthorization: () => Promise<string | null>;
  onPinVerified: (userId: string) => void;
  onPinClose: () => void;
  verifyFn: ReturnType<typeof useVerifyManagerPin>;
}

export function useApplyLineDiscount(): ApplyLineDiscountState {
  const setLineDiscount = useCartStore((s) => s.setLineDiscount);
  const verifyFn = useVerifyManagerPin();

  const [targetItem, setTargetItem] = useState<CartItem | null>(null);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinResolver, setPinResolver] = useState<((id: string | null) => void) | null>(null);

  function openForItem(item: CartItem) { setTargetItem(item); }
  function closeDiscountModal() { setTargetItem(null); }

  function onConfirm(d: Discount) {
    if (targetItem) setLineDiscount(targetItem.id, d);
    setTargetItem(null);
  }

  function onRequireAuthorization(): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      setPinModalOpen(true);
      setPinResolver(() => resolve);
    });
  }

  function onPinVerified(userId: string) {
    pinResolver?.(userId);
    setPinResolver(null);
    setPinModalOpen(false);
  }

  function onPinClose() {
    pinResolver?.(null);
    setPinResolver(null);
    setPinModalOpen(false);
  }

  return {
    targetItem,
    pinModalOpen,
    openForItem,
    closeDiscountModal,
    onConfirm,
    onRequireAuthorization,
    onPinVerified,
    onPinClose,
    verifyFn,
  };
}

// Critique 2026-08-29 P1 — même base que ce que calculateTotals facture
// (lineTotalOf : combos ADR-017 + arrondi). La recomposition locale aurait
// assis une remise % sur une base fausse si une ligne combo devenait éligible.
export function lineDiscountBase(item: CartItem): number {
  return lineTotalOf(item);
}
