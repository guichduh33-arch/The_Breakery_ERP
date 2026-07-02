// apps/pos/src/features/display/__tests__/cart-broadcast-payment-complete.smoke.test.tsx
//
// S57 P2.3 (C-D4) — the customer display confirms a sale ("Merci" + change to
// collect on cash) then reverts to the welcome idle state after ~8s. Non-cash
// tenders never show a change amount.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, render, screen } from '@testing-library/react';
import {
  broadcastPaymentComplete,
  PAYMENT_COMPLETE_DISPLAY_MS,
  type CartBroadcastMessage,
} from '../hooks/useCartBroadcast';
import { useCartBroadcastReceiver } from '../hooks/useCartBroadcastReceiver';
import { CDActiveCartView } from '../CDActiveCartView';

// Cross-instance BroadcastChannel fake: postMessage on one instance delivers to
// every OTHER open instance's onmessage (mirrors the real same-origin channel).
let instances: FakeBC[] = [];
class FakeBC {
  name: string;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  constructor(n: string) {
    this.name = n;
    instances.push(this);
  }
  postMessage(m: unknown) {
    for (const inst of instances) {
      if (inst !== this && inst.onmessage) inst.onmessage({ data: m });
    }
  }
  close() {
    instances = instances.filter((i) => i !== this);
  }
}

beforeEach(() => {
  instances = [];
  (globalThis as { BroadcastChannel: unknown }).BroadcastChannel = FakeBC as never;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useCartBroadcastReceiver — payment_complete (C-D4)', () => {
  it('surfaces payment_complete then reverts to null after the display window', () => {
    const { result } = renderHook(() => useCartBroadcastReceiver());
    expect(result.current).toBeNull();

    act(() => {
      broadcastPaymentComplete({ total: 66000, change: 4000, method: 'cash' });
    });
    expect(result.current?.type).toBe('payment_complete');

    act(() => {
      vi.advanceTimersByTime(PAYMENT_COMPLETE_DISPLAY_MS);
    });
    expect(result.current).toBeNull();
  });

  it('a subsequent cart_update cancels the revert and shows the new cart', () => {
    const { result } = renderHook(() => useCartBroadcastReceiver());
    act(() => {
      broadcastPaymentComplete({ total: 50000, change: null, method: 'card' });
    });
    expect(result.current?.type).toBe('payment_complete');

    const update: CartBroadcastMessage = {
      type: 'cart_update',
      cart: { items: [{ id: 'l1' }], order_type: 'dine_in' },
      totals: { subtotal: 10000, total: 10000, item_count: 1 },
      customer: null,
    };
    act(() => {
      // Emit from a separate channel instance (like the POS cart mirror would).
      const bc = new FakeBC('breakery-cart');
      bc.postMessage(update);
      bc.close();
    });
    expect(result.current?.type).toBe('cart_update');

    // The stale revert timer must not fire now that a cart is showing.
    act(() => {
      vi.advanceTimersByTime(PAYMENT_COMPLETE_DISPLAY_MS);
    });
    expect(result.current?.type).toBe('cart_update');
  });
});

describe('CDActiveCartView — payment_complete screen (C-D4)', () => {
  it('shows Merci + the change to collect for a cash sale', () => {
    const msg: CartBroadcastMessage = {
      type: 'payment_complete',
      total: 66000,
      change: 4000,
      method: 'cash',
    };
    render(<CDActiveCartView message={msg} />);
    expect(screen.getByTestId('cd-payment-complete')).toBeInTheDocument();
    expect(screen.getByText(/merci/i)).toBeInTheDocument();
    expect(screen.getByText(/monnaie à rendre/i)).toBeInTheDocument();
    expect(screen.getByText(/4.?000/)).toBeInTheDocument();
  });

  it('masks the change amount for a non-cash tender', () => {
    const msg: CartBroadcastMessage = {
      type: 'payment_complete',
      total: 50000,
      change: 0,
      method: 'card',
    };
    render(<CDActiveCartView message={msg} />);
    expect(screen.getByText(/merci/i)).toBeInTheDocument();
    expect(screen.queryByText(/monnaie à rendre/i)).toBeNull();
  });
});
