// apps/pos/src/stores/__tests__/cartStore.void.test.ts
//
// Session 36 — voidOrder() wipes the WHOLE order, including lines already fired
// to the kitchen (unlike clear(), which keeps locked lines), plus all per-order
// transient state.

import { describe, it, expect, beforeEach } from 'vitest';
import type { CartItem } from '@breakery/domain';
import { useCartStore } from '../cartStore';

const SENT: CartItem = { id: 'a', product_id: 'p1', name: 'Sent item', unit_price: 20000, quantity: 1, modifiers: [] };
const OPEN: CartItem = { id: 'b', product_id: 'p2', name: 'Open item', unit_price: 15000, quantity: 1, modifiers: [] };

beforeEach(() => {
  useCartStore.setState({
    cart: {
      items: [SENT, OPEN],
      order_type: 'dine_in',
      tableNumber: 'T-01',
      cartDiscount: { type: 'percentage', value: 10, amount: 3500, reason: 'x' },
      loyaltyPointsToRedeem: 100,
    },
    lockedItemIds: ['a'],
    printedItemIds: ['a'],
    appliedPromotions: [
      { promotion_id: 'pr', slug: 's', name: 'n', type: 'percentage', amount: 1000, description: 'd' },
    ],
    dismissedPromotionIds: new Set<string>(),
    attachedCustomer: null,
    pickedUpOrderId: null,
  });
});

describe('cartStore.voidOrder', () => {
  it('removes ALL items including locked/sent ones and resets per-order state', () => {
    useCartStore.getState().voidOrder();
    const s = useCartStore.getState();
    expect(s.cart.items).toHaveLength(0);
    expect(s.lockedItemIds).toHaveLength(0);
    expect(s.printedItemIds).toHaveLength(0);
    expect(s.appliedPromotions).toHaveLength(0);
    expect(s.cart.cartDiscount).toBeUndefined();
    expect(s.cart.loyaltyPointsToRedeem).toBeUndefined();
  });

  it('preserves order_type so the cashier can immediately re-ring', () => {
    useCartStore.getState().voidOrder();
    expect(useCartStore.getState().cart.order_type).toBe('dine_in');
  });

  it('contrasts with clear() which keeps locked/sent lines', () => {
    useCartStore.getState().clear();
    // clear keeps the locked line 'a', drops the unlocked 'b'
    const items = useCartStore.getState().cart.items;
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe('a');
  });
});
