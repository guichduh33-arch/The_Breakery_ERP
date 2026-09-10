import { act, renderHook } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useCartBroadcast } from '../hooks/useCartBroadcast';
import { useLocalDisplayConnection } from '../hooks/useCartBroadcastReceiver';
import { getDisplaySourceId } from '../displaySource';
import { useCartStore } from '@/stores/cartStore';
import { usePaymentStore } from '@/stores/paymentStore';

class Channel {
  static all = new Set<Channel>();
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(readonly name: string) { Channel.all.add(this); }
  postMessage(data: unknown) { for (const other of Channel.all) if (other !== this && other.name === this.name) other.onmessage?.({ data } as MessageEvent); }
  close() { Channel.all.delete(this); }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('BroadcastChannel', Channel);
  usePaymentStore.getState().reset();
  useCartStore.setState({ cart: { order_type: 'take_out', items: [{ id: 'l1', product_id: 'p1', name: 'Coffee', unit_price: 25000, quantity: 1, modifiers: [] }] }, attachedCustomer: null });
});
afterEach(() => { Channel.all.clear(); vi.useRealTimers(); });

describe('local customer display', () => {
  it('requests the existing cart when opened late and ignores another checkout source', () => {
    renderHook(() => useCartBroadcast());
    const receiver = renderHook(() => useLocalDisplayConnection(getDisplaySourceId()));
    const other = renderHook(() => useLocalDisplayConnection('another-checkout'));
    expect(receiver.result.current.connected).toBe(true);
    expect(receiver.result.current.message?.type).toBe('cart_update');
    expect(other.result.current.message).toBeNull();
  });
  it('detects a closed checkout and removes the stale customer cart', () => {
    const source = renderHook(() => useCartBroadcast());
    const receiver = renderHook(() => useLocalDisplayConnection(getDisplaySourceId()));
    source.unmount();
    act(() => { vi.advanceTimersByTime(8000); });
    expect(receiver.result.current.connected).toBe(false);
    expect(receiver.result.current.message).toBeNull();
  });
});
