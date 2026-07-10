// apps/pos/src/stores/__tests__/cartStore.restoreLine.test.ts
//
// Cart redesign v2 — restoreLine() backs the 5s "undo" toast on the delete
// gesture: a removed line is re-inserted at its former index, and a double-undo
// (or a race that already restored it) is a no-op.

import { describe, it, expect, beforeEach } from 'vitest';
import type { CartItem } from '@breakery/domain';
import { useCartStore } from '../cartStore';

const A: CartItem = { id: 'a', product_id: 'p1', name: 'A', unit_price: 10000, quantity: 1, modifiers: [] };
const B: CartItem = { id: 'b', product_id: 'p2', name: 'B', unit_price: 20000, quantity: 1, modifiers: [] };
const C: CartItem = { id: 'c', product_id: 'p3', name: 'C', unit_price: 30000, quantity: 1, modifiers: [] };

beforeEach(() => {
  useCartStore.setState({
    cart: { items: [A, B, C], order_type: 'take_out' },
    lockedItemIds: [],
    printedItemIds: [],
    attachedCustomer: null,
    pickedUpOrderId: null,
    appliedPromotions: [],
    dismissedPromotionIds: new Set<string>(),
  });
});

describe('cartStore.restoreLine', () => {
  it('re-inserts a removed line at its former index', () => {
    const store = useCartStore.getState();
    store.remove('b'); // A, C
    expect(useCartStore.getState().cart.items.map((i) => i.id)).toEqual(['a', 'c']);

    store.restoreLine(B, 1);
    expect(useCartStore.getState().cart.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('is a no-op when a line with the same id is already present (double-undo)', () => {
    useCartStore.getState().restoreLine(A, 0);
    expect(useCartStore.getState().cart.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('clamps an out-of-range index to the list bounds', () => {
    useCartStore.getState().remove('a'); // B, C
    useCartStore.getState().restoreLine(A, 99);
    expect(useCartStore.getState().cart.items.map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });
});
