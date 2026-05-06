// apps/pos/src/features/discounts/hooks/useApplyCartDiscount.ts
import { useState } from 'react';
import { calculateTotals, pointsToValue } from '@breakery/domain';
import type { Discount } from '@breakery/domain';
import { useCartStore } from '@/stores/cartStore';
import { useVerifyManagerPin } from './useVerifyManagerPin';

const TAX_RATE = 0.10;

export interface ApplyCartDiscountState {
  discountModalOpen: boolean;
  pinModalOpen: boolean;
  base: number;
  openDiscountModal: () => void;
  closeDiscountModal: () => void;
  onConfirm: (d: Discount) => void;
  onRequireAuthorization: () => Promise<string | null>;
  onPinVerified: (userId: string) => void;
  onPinClose: () => void;
  verifyFn: ReturnType<typeof useVerifyManagerPin>;
}

export function useApplyCartDiscount(): ApplyCartDiscountState {
  const cart = useCartStore((s) => s.cart);
  const setCartDiscount = useCartStore((s) => s.setCartDiscount);
  const verifyFn = useVerifyManagerPin();

  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinResolver, setPinResolver] = useState<((id: string | null) => void) | null>(null);

  const totals = calculateTotals(cart, TAX_RATE);
  const redemption = pointsToValue(cart.loyaltyPointsToRedeem ?? 0);
  const base = totals.subtotal - redemption;

  function openDiscountModal() { setDiscountModalOpen(true); }
  function closeDiscountModal() { setDiscountModalOpen(false); }

  function onConfirm(d: Discount) {
    setCartDiscount(d);
    setDiscountModalOpen(false);
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
    discountModalOpen,
    pinModalOpen,
    base,
    openDiscountModal,
    closeDiscountModal,
    onConfirm,
    onRequireAuthorization,
    onPinVerified,
    onPinClose,
    verifyFn,
  };
}
