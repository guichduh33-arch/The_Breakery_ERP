// apps/pos/src/features/promotions/__tests__/promotion-vs-manual-line.smoke.test.tsx
// Session 8 smoke test — P12 conflict: promotion vs manual line-item discount.
// Spec: when a manual line discount is already applied, the promo engine skips
// (or is excluded). Here we verify that having BOTH an appliedPromotion AND a
// manual line discount does not break calculateTotals, and that the UI renders
// both lines separately.
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { calculateTotals } from '@breakery/domain';
import type { AppliedPromotion, CartItem } from '@breakery/domain';
import { PromotionsSummary } from '@/features/promotions/components/PromotionsSummary';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      setSession: vi.fn(),
      signOut: vi.fn().mockResolvedValue({}),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
          not: vi.fn(() => ({ not: vi.fn().mockResolvedValue({ data: [], error: null }) })),
        })),
        not: vi.fn(() => ({ not: vi.fn().mockResolvedValue({ data: [], error: null }) })),
      })),
    })),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    })),
    removeChannel: vi.fn(),
  },
  supabaseUrl: 'http://localhost:54321',
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ITEM_WITH_LINE_DISCOUNT: CartItem = {
  id: 'l1',
  product_id: 'p1',
  name: 'Americano',
  unit_price: 35000,
  quantity: 2,
  modifiers: [],
  discount: {
    type: 'percentage',
    value: 10,
    amount: 7000, // 10% of 70000
    reason: 'VIP deal',
    authorized_by: 'mgr-1',
  },
};

const CART_PROMO: AppliedPromotion = {
  promotion_id: 'promo-cart-001',
  name: 'Cart 5% off',
  action_type: 'percentage_off',
  target: 'cart',
  target_product_id: null,
  discount_amount: 3150, // 5% of (70000 - 7000) = 63000
  items_to_add: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapper(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('promotion-vs-manual-line smoke (P12 conflict)', () => {
  beforeEach(() => {
    useCartStore.setState({
      cart: {
        items: [ITEM_WITH_LINE_DISCOUNT],
        order_type: 'dine_in',
      },
      lockedItemIds: [],
      attachedCustomer: null,
      pickedUpOrderId: null,
      appliedPromotion: null,
      previewItems: [],
    });
    vi.clearAllMocks();
  });

  it('PromotionsSummary renders promo even when line discount is present', () => {
    useCartStore.getState().setAppliedPromotion(CART_PROMO);
    render(wrapper(<PromotionsSummary />));
    expect(screen.getByText(/Cart 5% off/)).toBeInTheDocument();
  });

  it('calculateTotals handles line discount + cart promo without throwing', () => {
    useCartStore.getState().setAppliedPromotion(CART_PROMO);
    const cart = useCartStore.getState().cart;
    // line total = 70000, line discount = 7000, items_total = 63000
    // promo = 3150 → post_promo = 59850
    expect(() => calculateTotals(cart, 0.1)).not.toThrow();
    const totals = calculateTotals(cart, 0.1);
    expect(totals.total).toBe(59850);
  });

  it('no promotion applied leaves items_total unchanged by promo', () => {
    // appliedPromotion stays null
    const cart = useCartStore.getState().cart;
    const totals = calculateTotals(cart, 0.1);
    // items_total = 70000 - 7000 = 63000
    expect(totals.total).toBe(63000);
  });
});
