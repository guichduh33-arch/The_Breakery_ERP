/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCartStore } from '@/stores/cartStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { useCartBroadcast } from '../hooks/useCartBroadcast';

let posted: unknown[] = [];
class FakeBC {
  static current: FakeBC;
  name: string;
  onmessage: ((event: { data: { type: string } }) => void) | null = null;
  constructor(n: string) { this.name = n; FakeBC.current = this; }
  postMessage(m: unknown) { posted.push(m); }
  close() { /* noop */ }
}

beforeEach(() => {
  vi.useFakeTimers();
  posted = [];
  usePaymentStore.setState({ attempt: null });
  (globalThis as { BroadcastChannel: unknown }).BroadcastChannel = FakeBC;
  useCartStore.setState({
    cart: { items: [], order_type: 'dine_in' }, lockedItemIds: [], printedItemIds: [],
    attachedCustomer: null, pickedUpOrderId: null, appliedPromotions: [],
    dismissedPromotionIds: new Set(), isOffline: false,
  } as never);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('useCartBroadcast', () => {
  it('posts a cart_update when the cart changes', () => {
    renderHook(() => useCartBroadcast());
    act(() => {
      useCartStore.setState({
        cart: { items: [{ id: 'l1', product_id: 'p1', name: 'X', unit_price: 1000, quantity: 1, modifiers: [] }], order_type: 'dine_in' },
      } as never);
    });
    act(() => { vi.advanceTimersByTime(20); });
    const last = posted.at(-1) as { type: string; cart: { items: unknown[] } };
    expect(last.type).toBe('cart_update');
    expect(last.cart.items.length).toBe(1);
  });

  it('groups cart updates and ignores unrelated store changes', () => {
    const { unmount } = renderHook(() => useCartBroadcast());
    act(() => {
      useCartStore.setState({ isOffline: true });
    });
    expect(posted).toHaveLength(1);
    act(() => {
      useCartStore.setState({ cart: { items: [], order_type: 'take_out' } } as never);
      useCartStore.setState({ cart: { items: [], order_type: 'dine_in' } } as never);
    });
    expect(posted).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(20); });
    expect(posted).toHaveLength(2);
    act(() => { useCartStore.setState({ cart: { items: [], order_type: 'take_out' } } as never); });
    unmount();
    act(() => { vi.advanceTimersByTime(20); });
    expect(posted).toHaveLength(2);
  });

  it('answers request_state immediately and mirrors the payment attempt', () => {
    renderHook(() => useCartBroadcast());
    act(() => {
      usePaymentStore.setState({ attempt: { state: 'pending', cart: { items: [], order_type: 'take_out' }, customer: { name: 'Snapshot' } } } as never);
      FakeBC.current.onmessage?.({ data: { type: 'request_state' } });
    });
    expect((posted.at(-1) as { customer: { name: string } }).customer.name).toBe('Snapshot');
    act(() => { vi.advanceTimersByTime(20); });
    expect((posted.at(-1) as { cart: { order_type: string } }).cart.order_type).toBe('take_out');
    act(() => usePaymentStore.setState({ attempt: null }));
    act(() => { vi.advanceTimersByTime(20); });
    expect((posted.at(-1) as { customer: unknown }).customer).toBeNull();
  });
});
