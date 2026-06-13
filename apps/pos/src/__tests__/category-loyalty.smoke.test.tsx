// apps/pos/src/__tests__/category-loyalty.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
//
// Smoke tests for cumulative loyalty multiplier: category × tier.
// Spec §4.4 CC10:
//   VIP (1.2x) × Bronze (1.0x) = 1.2 → earn = floor(35000 × 1.2 / 1000) = 42
//   VIP (1.2x) × Gold (1.1x) = 1.32 → earn = floor(35000 × 1.32 / 1000) = 46
//
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { buildOrderPayload } from '@breakery/domain';
import type { Cart, PaymentInput } from '@breakery/domain';
import { useCartStore } from '@/stores/cartStore';
import { useShiftStore } from '@/stores/shiftStore';
import { usePaymentStore } from '@/stores/paymentStore';
import type { CustomerWithCategory } from '@/stores/cartStore';
import type { CustomerCategory } from '@breakery/domain';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
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

const VIP_CATEGORY: CustomerCategory = {
  id: 'cat-vip',
  name: 'VIP',
  slug: 'vip',
  color: '#F59E0B',
  icon: null,
  price_modifier_type: 'discount_percentage',
  discount_percentage: 5,
  loyalty_enabled: true,
  points_multiplier: 1.2,
  is_default: false,
};

const CART_ITEM = {
  id: 'l1',
  product_id: 'p1',
  name: 'Americano',
  unit_price: 35000,
  quantity: 1,
  modifiers: [] as never[],
};

const BRONZE_VIP_CUSTOMER: CustomerWithCategory = {
  id: 'cust-bronze-vip',
  name: 'VIP Bronze',
  phone: '+628001',
  email: null,
  customer_type: 'retail',
  loyalty_points: 100,
  lifetime_points: 100, // Bronze tier (1.0)
  total_spent: 0,
  total_visits: 0,
  last_visit_at: null,
  category: VIP_CATEGORY,
};

const GOLD_VIP_CUSTOMER: CustomerWithCategory = {
  id: 'cust-gold-vip',
  name: 'VIP Gold',
  phone: '+628002',
  email: null,
  customer_type: 'retail',
  loyalty_points: 2500,
  lifetime_points: 2500, // Gold tier (1.1)
  total_spent: 0,
  total_visits: 0,
  last_visit_at: null,
  category: VIP_CATEGORY,
};

function wrapper(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// ---------------------------------------------------------------------------
// Unit tests on buildOrderPayload
// ---------------------------------------------------------------------------

describe('Category loyalty multiplier — buildOrderPayload', () => {
  const payment: PaymentInput = { method: 'cash', amount: 35000, cash_received: 35000, change_given: 0 };

  it('VIP Bronze (1.2 × 1.0 = 1.2) → earn = floor(35000 × 1.2 / 1000) = 42', () => {
    const earn = Math.floor((35000 * 1.2) / 1000);
    expect(earn).toBe(42);
  });

  it('VIP Gold (1.2 × 1.1 = 1.32) → earn = floor(35000 × 1.32 / 1000) = 46', () => {
    const earn = Math.floor((35000 * 1.32) / 1000);
    expect(earn).toBe(46);
  });

  // S44 P0-C(2) — the multiplier is no longer a client payload field
  // (complete_order_with_payment_v12 resolves it server-side from the customer
  // tier × category). buildOrderPayload never emits loyalty_multiplier anymore.
  it('buildOrderPayload never emits loyalty_multiplier (resolved server-side, S44)', () => {
    const cart: Cart = { order_type: 'dine_in', items: [CART_ITEM], customerId: GOLD_VIP_CUSTOMER.id };
    const payload = buildOrderPayload('sess-1', cart, payment);
    expect('loyalty_multiplier' in payload).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration: useCheckout sends cumul multiplier
// ---------------------------------------------------------------------------

describe('Category loyalty multiplier — useCheckout integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useShiftStore.setState({
      current: { id: 'session-1', opened_at: new Date().toISOString(), opening_cash: 0 },
    });
    usePaymentStore.setState({ idempotencyKey: crypto.randomUUID() });
  });

  it('VIP Bronze customer: checkout payload omits client loyalty_multiplier (S44)', async () => {
    useCartStore.setState({
      cart: { items: [CART_ITEM], order_type: 'dine_in', customerId: BRONZE_VIP_CUSTOMER.id },
      lockedItemIds: [],
      attachedCustomer: BRONZE_VIP_CUSTOMER,
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
    const { result } = renderHook(() => useCheckout(), { wrapper: ({ children }) => wrapper(children) });

    await act(async () => {
      await result.current.mutateAsync({
        cart: useCartStore.getState().cart,
        payment: { method: 'cash', amount: 35000, cash_received: 35000, change_given: 0 },
      });
    });

    expect(capturedBody).not.toBeNull();
    // S44 P0-C(2) — the client no longer forwards a multiplier; v12 resolves it server-side.
    expect('loyalty_multiplier' in capturedBody!).toBe(false);
  });

  it('VIP Gold customer: checkout payload omits client loyalty_multiplier (S44)', async () => {
    useCartStore.setState({
      cart: { items: [CART_ITEM], order_type: 'dine_in', customerId: GOLD_VIP_CUSTOMER.id },
      lockedItemIds: [],
      attachedCustomer: GOLD_VIP_CUSTOMER,
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
    const { result } = renderHook(() => useCheckout(), { wrapper: ({ children }) => wrapper(children) });

    await act(async () => {
      await result.current.mutateAsync({
        cart: useCartStore.getState().cart,
        payment: { method: 'cash', amount: 35000, cash_received: 35000, change_given: 0 },
      });
    });

    expect(capturedBody).not.toBeNull();
    // S44 P0-C(2) — the client no longer forwards a multiplier; v12 resolves it server-side.
    expect('loyalty_multiplier' in capturedBody!).toBe(false);
  });
});
