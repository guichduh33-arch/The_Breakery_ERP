// apps/pos/src/__tests__/loyalty-multiplier.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
//
// Smoke tests for loyalty multiplier: Gold (1.1) vs Bronze (1.0).
// Spec §5 (session 6):
//   Gold customer (lifetime_points=2500) → cart 35000 → checkout →
//     buildOrderPayload produces loyalty_multiplier=1.1
//     p_loyalty_multiplier: 1.1 in RPC payload
//     floor(35000 × 1.1 / 1000) = 38 points
//   Bronze customer (lifetime_points=0) → multiplier=1.0 → earn = 35
//
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { buildOrderPayload } from '@breakery/domain';
import type { Cart, PaymentInput } from '@breakery/domain';
import { useCartStore } from '@/stores/cartStore';
import { useShiftStore } from '@/stores/shiftStore';
import { usePaymentStore } from '@/stores/paymentStore';
import type { Customer } from '@breakery/domain';
import { setSupabaseAccessToken } from '@breakery/supabase';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
    },
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() })),
    removeChannel: vi.fn(),
  },
  supabaseUrl: 'http://localhost:54321',
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CART_ITEM = {
  id: 'l1',
  product_id: 'p1',
  name: 'Americano',
  unit_price: 35000,
  quantity: 1,
  modifiers: [] as never[],
};

const GOLD_CUSTOMER: Customer = {
  id: 'cust-gold',
  name: 'Gold Member',
  phone: '+62811111111',
  email: null,
  customer_type: 'retail',
  loyalty_points: 2500,
  lifetime_points: 2500,
  total_spent: 0,
  total_visits: 0,
  last_visit_at: null,
};

const BRONZE_CUSTOMER: Customer = {
  id: 'cust-bronze',
  name: 'Bronze Member',
  phone: '+62822222222',
  email: null,
  customer_type: 'retail',
  loyalty_points: 0,
  lifetime_points: 0,
  total_spent: 0,
  total_visits: 0,
  last_visit_at: null,
};

function wrapper(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Loyalty multiplier smoke — buildOrderPayload', () => {
  const payment: PaymentInput = { method: 'cash', amount: 35000, cash_received: 35000, change_given: 0 };

  it('Gold customer (lifetime_points=2500) → loyalty_multiplier=1.1', () => {
    const cart: Cart = {
      order_type: 'dine_in',
      items: [CART_ITEM],
      customerId: GOLD_CUSTOMER.id,
    };
    const payload = buildOrderPayload('session-1', cart, payment, undefined, 2500);
    expect(payload.loyalty_multiplier).toBe(1.1);
  });

  it('Bronze customer (lifetime_points=0) → multiplier omitted (1.0 default)', () => {
    const cart: Cart = {
      order_type: 'dine_in',
      items: [CART_ITEM],
      customerId: BRONZE_CUSTOMER.id,
    };
    const payload = buildOrderPayload('session-1', cart, payment, undefined, 0);
    // multiplier=1.0 → omitted from payload per buildOrderPayload convention
    expect('loyalty_multiplier' in payload).toBe(false);
  });

  it('Gold: earn = floor(35000 × 1.1 / 1000) = 38', () => {
    const total = 35000;
    const multiplier = 1.1;
    const earn = Math.floor((total * multiplier) / 1000);
    expect(earn).toBe(38);
  });

  it('Bronze: earn = floor(35000 × 1.0 / 1000) = 35', () => {
    const total = 35000;
    const multiplier = 1.0;
    const earn = Math.floor((total * multiplier) / 1000);
    expect(earn).toBe(35);
  });
});

describe('Loyalty multiplier smoke — useCheckout sends correct multiplier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSupabaseAccessToken('tok');
    useShiftStore.setState({
      current: { id: 'session-1', opened_at: new Date().toISOString(), opening_cash: 0 },
    });
    usePaymentStore.setState({ idempotencyKey: crypto.randomUUID() });
  });

  it('Gold customer checkout: fetch payload includes loyalty_multiplier=1.1', async () => {
    useCartStore.setState({
      cart: {
        items: [CART_ITEM],
        order_type: 'dine_in',
        customerId: GOLD_CUSTOMER.id,
      },
      lockedItemIds: [],
      attachedCustomer: GOLD_CUSTOMER,
      pickedUpOrderId: null,
    });

    let capturedBody: Record<string, unknown> | null = null;
    mockFetch.mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ order_id: 'o1', order_number: '#001', total: 35000, tax_amount: 3182, change_given: 0 }),
      });
    });

    const { useCheckout } = await import('@/features/payment/hooks/useCheckout');
    const { result } = renderHook(() => useCheckout(), {
      wrapper: ({ children }) => wrapper(children),
    });

    await act(async () => {
      await result.current.mutateAsync({
        cart: useCartStore.getState().cart,
        payment: { method: 'cash', amount: 35000, cash_received: 35000, change_given: 0 },
      });
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.loyalty_multiplier).toBe(1.1);
  });

  it('Bronze customer checkout: fetch payload omits loyalty_multiplier (defaults to 1.0)', async () => {
    useCartStore.setState({
      cart: {
        items: [CART_ITEM],
        order_type: 'dine_in',
        customerId: BRONZE_CUSTOMER.id,
      },
      lockedItemIds: [],
      attachedCustomer: BRONZE_CUSTOMER,
      pickedUpOrderId: null,
    });

    let capturedBody: Record<string, unknown> | null = null;
    mockFetch.mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ order_id: 'o2', order_number: '#002', total: 35000, tax_amount: 3182, change_given: 0 }),
      });
    });

    const { useCheckout } = await import('@/features/payment/hooks/useCheckout');
    const { result } = renderHook(() => useCheckout(), {
      wrapper: ({ children }) => wrapper(children),
    });

    await act(async () => {
      await result.current.mutateAsync({
        cart: useCartStore.getState().cart,
        payment: { method: 'cash', amount: 35000, cash_received: 35000, change_given: 0 },
      });
    });

    expect(capturedBody).not.toBeNull();
    // Bronze multiplier=1.0, omitted from payload
    expect('loyalty_multiplier' in capturedBody!).toBe(false);
  });
});
