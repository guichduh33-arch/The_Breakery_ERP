/// <reference types="@testing-library/jest-dom" />
// apps/pos/src/features/display/__tests__/cart-broadcast-promo.smoke.test.tsx
//
// Session 37 — B2: customer display must broadcast the post-promotion total.
// The previous implementation called calculateTotals() only, ignoring
// appliedPromotions and cartDiscount.
// ADR-013 D11 — la promo entre dans le cart via setAppliedPromotions (qui
// écrit cart.promotionTotal, source unique) : les tests passent par ce chemin
// de production, plus par un setState brut de appliedPromotions.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCartStore } from '@/stores/cartStore';
import { useCartBroadcast, type CartUpdateMessage } from '../hooks/useCartBroadcast';

let posted: unknown[] = [];
class FakeBC {
  name: string;
  constructor(n: string) { this.name = n; }
  postMessage(m: unknown) { posted.push(m); }
  close() { /* noop */ }
}

beforeEach(() => {
  posted = [];
  (globalThis as { BroadcastChannel: unknown }).BroadcastChannel = FakeBC;
  useCartStore.setState({
    cart: { items: [], order_type: 'dine_in' },
    lockedItemIds: [],
    printedItemIds: [],
    attachedCustomer: null,
    pickedUpOrderId: null,
    appliedPromotions: [],
    dismissedPromotionIds: new Set(),
    isOffline: false,
  } as never);
});
afterEach(() => { vi.restoreAllMocks(); });

const ITEM = { id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 30000, quantity: 2, modifiers: [] };

describe('useCartBroadcast — post-promo total (POS-02)', () => {
  it('deducts applied promotions from the broadcast total', () => {
    renderHook(() => useCartBroadcast());

    act(() => {
      useCartStore.setState({
        cart: {
          items: [ITEM],
          order_type: 'dine_in',
        },
      } as never);
      // A promotion worth 5 000 off the order — production path (D11).
      useCartStore.getState().setAppliedPromotions([
        { promotion_id: 'promo-1', amount: 5000, description: '5k off' } as never,
      ]);
    });

    const last = posted.at(-1) as CartUpdateMessage;
    expect(last.type).toBe('cart_update');

    // calculateTotals: 2 × 30 000 = 60 000 subtotal; tax included → total ≈ 60 000 (gross)
    // promotion deduction: total − 5 000 = 55 000
    // The exact gross total from calculateTotals with 10% tax:
    // subtotal = 60 000; total = subtotal (tax is extracted, not added) → 60 000
    // after promo: 60 000 − 5 000 = 55 000
    expect(last.totals.total).toBe(55000);
  });

  it('deducts both promotion and cartDiscount from the broadcast total', () => {
    renderHook(() => useCartBroadcast());

    act(() => {
      useCartStore.setState({
        cart: {
          items: [ITEM],
          order_type: 'dine_in',
          cartDiscount: { amount: 3000, type: 'fixed', value: 3000, reason: 'test' },
        },
      } as never);
      useCartStore.getState().setAppliedPromotions([
        { promotion_id: 'promo-1', amount: 5000, description: '5k off' } as never,
      ]);
    });

    const last = posted.at(-1) as CartUpdateMessage;
    // 60 000 − 5 000 promo − 3 000 cart discount = 52 000
    expect(last.totals.total).toBe(52000);
  });

  it('does not go below zero even if discounts exceed the total', () => {
    renderHook(() => useCartBroadcast());

    act(() => {
      useCartStore.setState({
        cart: {
          items: [{ id: 'l1', product_id: 'p1', name: 'X', unit_price: 1000, quantity: 1, modifiers: [] }],
          order_type: 'dine_in',
        },
      } as never);
      // D11 — le store clampe promotionTotal aux items : jamais d'état
      // au-dessous de zéro (et jamais de throw DiscountExceedsTotalError au render).
      useCartStore.getState().setAppliedPromotions([
        { promotion_id: 'promo-1', amount: 99999, description: 'massive off' } as never,
      ]);
    });

    const last = posted.at(-1) as CartUpdateMessage;
    expect(last.totals.total).toBeGreaterThanOrEqual(0);
  });
});
