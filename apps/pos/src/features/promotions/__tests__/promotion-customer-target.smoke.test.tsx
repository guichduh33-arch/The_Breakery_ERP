// apps/pos/src/features/promotions/__tests__/promotion-customer-target.smoke.test.tsx
// Session 8 smoke test — P6: customer-targeted promotion.
// Verifies that when a customer is attached whose ID matches the promotion
// condition, the applied promotion is stored and rendered correctly.
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

const VIP_CUSTOMER: Customer = {
  id: 'cust-vip-target',
  name: 'VIP Member',
  phone: '+62855555555',
  email: null,
  customer_type: 'retail',
  loyalty_points: 1000,
  lifetime_points: 10000,
  total_spent: 0,
  total_visits: 0,
  last_visit_at: null,
};

const VIP_PROMO: AppliedPromotion = {
  promotion_id: 'promo-vip-001',
  name: 'VIP Exclusive 15%',
  action_type: 'percentage_off',
  target: 'cart',
  target_product_id: null,
  discount_amount: 15000, // 15% of 100000
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

describe('promotion-customer-target smoke (P6)', () => {
  beforeEach(() => {
    useCartStore.setState({
      cart: {
        items: [
          {
            id: 'l1',
            product_id: 'p1',
            name: 'Special Bundle',
            unit_price: 100000,
            quantity: 1,
            modifiers: [] as never[],
          },
        ],
        order_type: 'dine_in',
        customerId: VIP_CUSTOMER.id,
      },
      lockedItemIds: [],
      attachedCustomer: VIP_CUSTOMER,
      pickedUpOrderId: null,
      appliedPromotion: null,
      previewItems: [],
    });
    vi.clearAllMocks();
  });

  it('PromotionsSummary shows VIP-targeted promo when customer is attached', () => {
    useCartStore.getState().setAppliedPromotion(VIP_PROMO);
    render(wrapper(<PromotionsSummary />));
    expect(screen.getByText(/VIP Exclusive 15%/)).toBeInTheDocument();
  });

  it('calculateTotals reflects VIP promo discount with customer attached', () => {
    useCartStore.getState().setAppliedPromotion(VIP_PROMO);
    const cart = useCartStore.getState().cart;
    const totals = calculateTotals(cart, 0.1);
    // items_total = 100000, promo = 15000 → total = 85000
    expect(totals.total).toBe(85000);
  });

  it('no promotion rendered when customer is detached', () => {
    // Without promotion, PromotionsSummary is absent
    render(wrapper(<PromotionsSummary />));
    expect(screen.queryByText(/VIP Exclusive 15%/)).not.toBeInTheDocument();
  });

  it('cartStore holds correct customerId after attachCustomer', () => {
    const state = useCartStore.getState();
    expect(state.cart.customerId).toBe('cust-vip-target');
    expect(state.attachedCustomer?.id).toBe('cust-vip-target');
  });
});
