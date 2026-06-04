/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCartStore } from '@/stores/cartStore';
import { useCartBroadcast } from '../hooks/useCartBroadcast';

let posted: unknown[] = [];
class FakeBC {
  name: string;
  constructor(n: string) { this.name = n; }
  postMessage(m: unknown) { posted.push(m); }
  close() { /* noop */ }
}

beforeEach(() => {
  posted = [];
  (globalThis as { BroadcastChannel: unknown }).BroadcastChannel = FakeBC as never;
  useCartStore.setState({
    cart: { items: [], order_type: 'dine_in' }, lockedItemIds: [], printedItemIds: [],
    attachedCustomer: null, pickedUpOrderId: null, appliedPromotions: [],
    dismissedPromotionIds: new Set(), isOffline: false,
  } as never);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('useCartBroadcast', () => {
  it('posts a cart_update when the cart changes', () => {
    renderHook(() => useCartBroadcast());
    act(() => {
      useCartStore.setState({
        cart: { items: [{ id: 'l1', product_id: 'p1', name: 'X', unit_price: 1000, quantity: 1, modifiers: [] }], order_type: 'dine_in' },
      } as never);
    });
    const last = posted.at(-1) as { type: string; cart: { items: unknown[] } };
    expect(last.type).toBe('cart_update');
    expect(last.cart.items.length).toBe(1);
  });
});
