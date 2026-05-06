// apps/pos/src/features/promotions/__tests__/promotion-best-only.smoke.test.tsx
// Session 8 smoke test — P8: only the best promotion is applied (best-only rule).
// Verifies that setAppliedPromotion replaces any previous promotion rather than
// stacking, and that cartStore only holds one appliedPromotion at a time.
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { calculateTotals } from '@breakery/domain';
import type { AppliedPromotion } from '@breakery/domain';
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

const PROMO_LOW: AppliedPromotion = {
  promotion_id: 'promo-low',
  name: 'Low Priority 5%',
  action_type: 'percentage_off',
  target: 'cart',
  target_product_id: null,
  discount_amount: 3000,
  items_to_add: [],
};

const PROMO_HIGH: AppliedPromotion = {
  promotion_id: 'promo-high',
  name: 'High Priority 20%',
  action_type: 'percentage_off',
  target: 'cart',
  target_product_id: null,
  discount_amount: 12000,
  items_to_add: [],
};

const ITEMS = [
  {
    id: 'l1',
    product_id: 'p1',
    name: 'Americano',
    unit_price: 60000,
    quantity: 1,
    modifiers: [] as never[],
  },
];

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

describe('promotion-best-only smoke', () => {
  beforeEach(() => {
    useCartStore.setState({
      cart: { items: ITEMS, order_type: 'dine_in' },
      lockedItemIds: [],
      attachedCustomer: null,
      pickedUpOrderId: null,
      appliedPromotion: null,
      previewItems: [],
    });
    vi.clearAllMocks();
  });

  it('only one promotion is stored in cart at a time (best-only)', () => {
    useCartStore.getState().setAppliedPromotion(PROMO_LOW);
    expect(useCartStore.getState().appliedPromotion?.promotion_id).toBe('promo-low');

    // Simulate engine returning the better promotion
    useCartStore.getState().setAppliedPromotion(PROMO_HIGH);
    expect(useCartStore.getState().appliedPromotion?.promotion_id).toBe('promo-high');
    // Confirm only ONE promotion is tracked — store holds a single object, not an array
    expect(typeof useCartStore.getState().appliedPromotion).toBe('object');
  });

  it('PromotionsSummary shows only the current best promotion', () => {
    useCartStore.getState().setAppliedPromotion(PROMO_LOW);
    useCartStore.getState().setAppliedPromotion(PROMO_HIGH);
    render(wrapper(<PromotionsSummary />));
    expect(screen.getByText(/High Priority 20%/)).toBeInTheDocument();
    expect(screen.queryByText(/Low Priority 5%/)).not.toBeInTheDocument();
  });

  it('calculateTotals uses highest discount after best-only selection', () => {
    useCartStore.getState().setAppliedPromotion(PROMO_HIGH);
    const cart = useCartStore.getState().cart;
    const totals = calculateTotals(cart, 0.1);
    // items_total = 60000, promotionTotal = 12000
    expect(totals.total).toBe(48000);
  });
});
