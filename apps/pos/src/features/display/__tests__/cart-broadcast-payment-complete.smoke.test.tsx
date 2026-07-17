// apps/pos/src/features/display/__tests__/cart-broadcast-payment-complete.smoke.test.tsx
//
// S57 P2.3 (C-D4) — the customer display confirms a sale ("Thank you" + change
// to collect on cash) then reverts to the welcome idle state after ~8s. Non-cash
// tenders never show a change amount.
// Split-brand redesign — the confirmation panel (CDPaymentPanel) also renders
// the payment method, the tax included in the total, and the loyalty outcome.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, render, screen } from '@testing-library/react';
import {
  broadcastPaymentComplete,
  PAYMENT_COMPLETE_DISPLAY_MS,
  type CartBroadcastMessage,
  type PaymentCompleteMessage,
} from '../hooks/useCartBroadcast';
import { useCartBroadcastReceiver } from '../hooks/useCartBroadcastReceiver';
import { CDPaymentPanel } from '../components/CDPaymentPanel';

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

/** Payload builder — anonymous cash sale unless overridden. */
function paymentComplete(
  overrides: Partial<Omit<PaymentCompleteMessage, 'type'>> = {},
): Omit<PaymentCompleteMessage, 'type'> {
  return {
    total: 66000,
    change: 4000,
    method: 'cash',
    tax_amount: 6000,
    tax_inclusive: true,
    customer_name: null,
    points_earned: null,
    loyalty_balance_after: null,
    ...overrides,
  };
}

beforeEach(() => {
  instances = [];
  (globalThis as { BroadcastChannel: unknown }).BroadcastChannel = FakeBC;
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
      broadcastPaymentComplete(paymentComplete());
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
      broadcastPaymentComplete(paymentComplete({ total: 50000, change: null, method: 'card' }));
    });
    expect(result.current?.type).toBe('payment_complete');

    const update: CartBroadcastMessage = {
      type: 'cart_update',
      cart: { items: [{ id: 'l1' }], order_type: 'dine_in' },
      totals: { subtotal: 10000, total: 10000, tax_amount: 909, item_count: 1, tax_inclusive: true },
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

describe('CDPaymentPanel — payment confirmation screen', () => {
  it('shows Thank you + method + tax included + the change to collect for a cash sale', () => {
    const msg: PaymentCompleteMessage = { type: 'payment_complete', ...paymentComplete() };
    render(<CDPaymentPanel message={msg} />);
    expect(screen.getByTestId('cd-payment-complete')).toBeInTheDocument();
    expect(screen.getByText(/thank you/i)).toBeInTheDocument();
    // Payment method label (shared with the payment grid).
    expect(screen.getByTestId('cd-payment-method')).toHaveTextContent(/cash/i);
    // Tax included in the (tax-inclusive) total.
    expect(screen.getByTestId('cd-payment-tax')).toHaveTextContent(/6.?000/);
    expect(screen.getByText(/change due/i)).toBeInTheDocument();
    expect(screen.getByText(/4.?000/)).toBeInTheDocument();
  });

  it('masks the change amount for a non-cash tender and shows the QRIS label', () => {
    const msg: PaymentCompleteMessage = {
      type: 'payment_complete',
      ...paymentComplete({ total: 50000, change: 0, method: 'qris', tax_amount: 4545 }),
    };
    render(<CDPaymentPanel message={msg} />);
    expect(screen.getByText(/thank you/i)).toBeInTheDocument();
    expect(screen.getByTestId('cd-payment-method')).toHaveTextContent(/qris/i);
    expect(screen.queryByText(/change due/i)).toBeNull();
  });

  it('greets the attached customer and shows the loyalty points earned + balance', () => {
    const msg: PaymentCompleteMessage = {
      type: 'payment_complete',
      ...paymentComplete({
        customer_name: 'Dewi',
        points_earned: 66,
        loyalty_balance_after: 1266,
      }),
    };
    render(<CDPaymentPanel message={msg} />);
    expect(screen.getByText(/thank you, dewi/i)).toBeInTheDocument();
    const loyalty = screen.getByTestId('cd-payment-loyalty');
    expect(loyalty).toHaveTextContent('+66 pts');
    expect(screen.getByTestId('cd-payment-loyalty-balance')).toHaveTextContent('1266');
  });

  it('omits the loyalty block entirely for anonymous sales', () => {
    const msg: PaymentCompleteMessage = { type: 'payment_complete', ...paymentComplete() };
    render(<CDPaymentPanel message={msg} />);
    expect(screen.queryByTestId('cd-payment-loyalty')).toBeNull();
  });
});
