// apps/pos/src/features/promotions/__tests__/promotion-stack-with-manual-loyalty.smoke.test.tsx
// Session 8 smoke test — P9: promotion stacks with manual loyalty point redemption.
// Spec: promotion discount applies first, then loyalty redemption is applied to
// the post-promo total. Both appear in the totals footer.
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { calculateTotals } from '@breakery/domain';
import type { AppliedPromotion, Customer } from '@breakery/domain';
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

const PROMO: AppliedPromotion = {
  promotion_id: 'promo-stack-001',
  name: 'Weekend 10%',
  action_type: 'percentage_off',
  target: 'cart',
  target_product_id: null,
  discount_amount: 10000,
  items_to_add: [],
};

const GOLD_CUSTOMER: Customer = {
  id: 'cust-gold',
  name: 'Gold Member',
  phone: '+62811111111',
  email: null,
  customer_type: 'retail',
  loyalty_points: 5000,
  lifetime_points: 5000,
  total_spent: 0,
  total_visits: 0,
  last_visit_at: null,
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

describe('promotion-stack-with-manual-loyalty smoke', () => {
  beforeEach(() => {
    useCartStore.setState({
      cart: {
        items: [
          {
            id: 'l1',
            product_id: 'p1',
            name: 'Bundle',
            unit_price: 100000,
            quantity: 1,
            modifiers: [] as never[],
          },
        ],
        order_type: 'dine_in',
      },
      lockedItemIds: [],
      attachedCustomer: GOLD_CUSTOMER,
      pickedUpOrderId: null,
      appliedPromotion: null,
      previewItems: [],
    });
    vi.clearAllMocks();
  });

  it('promotion summary displays while loyalty redemption is also set', () => {
    useCartStore.getState().setAppliedPromotion(PROMO);
    useCartStore.getState().setRedeemPoints(1000); // 1000 pts = 10000 IDR
    render(wrapper(<PromotionsSummary />));
    expect(screen.getByText(/Weekend 10%/)).toBeInTheDocument();
  });

  it('calculateTotals stacks promotion + loyalty redemption (promo first)', () => {
    useCartStore.getState().setAppliedPromotion(PROMO);
    // 1000 pts = 10000 IDR (spec: 10 IDR per point)
    useCartStore.getState().setRedeemPoints(1000);
    const cart = useCartStore.getState().cart;
    const totals = calculateTotals(cart, 0.1);
    // items_total = 100000
    // post_promo  = 100000 - 10000 = 90000
    // post_redemp = 90000 - 10000 = 80000
    expect(totals.total).toBe(80000);
    expect(totals.redemption_amount).toBe(10000);
  });

  it('appliedPromotion persists in store alongside loyalty points', () => {
    useCartStore.getState().setAppliedPromotion(PROMO);
    useCartStore.getState().setRedeemPoints(500);
    const state = useCartStore.getState();
    expect(state.appliedPromotion?.name).toBe('Weekend 10%');
    expect(state.cart.loyaltyPointsToRedeem).toBe(500);
  });
});
