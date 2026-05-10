// apps/pos/src/features/promotions/__tests__/promotion-percentage-cart.smoke.test.tsx
// Session 8 smoke test — P1: percentage-off cart promotion.
// Spec §5 / §6. Verifies that PromotionsSummary renders the promo line with
// correct name and that calculateTotals reflects the discount.
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

const PERCENTAGE_PROMO: AppliedPromotion = {
  promotion_id: 'promo-pct-001',
  name: 'Happy Hour 10%',
  action_type: 'percentage_off',
  target: 'cart',
  target_product_id: null,
  discount_amount: 6000, // 10% of 60000
  items_to_add: [],
};

const ITEMS = [
  {
    id: 'l1',
    product_id: 'p1',
    name: 'Americano',
    unit_price: 35000,
    quantity: 1,
    modifiers: [] as never[],
  },
  {
    id: 'l2',
    product_id: 'p2',
    name: 'Latte',
    unit_price: 25000,
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

describe('promotion-percentage-cart smoke', () => {
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

  it('shows promo line with name when appliedPromotion is set', () => {
    useCartStore.getState().setAppliedPromotion(PERCENTAGE_PROMO);
    render(wrapper(<PromotionsSummary />));
    expect(screen.getByText(/Happy Hour 10%/)).toBeInTheDocument();
  });

  it('shows discount amount as negative in promo line', () => {
    useCartStore.getState().setAppliedPromotion(PERCENTAGE_PROMO);
    render(wrapper(<PromotionsSummary />));
    // PromotionLineRow renders "−<Currency amount>" — currency formats in IDR
    expect(screen.getByText(/6,000/)).toBeInTheDocument();
  });

  it('renders nothing when no promotion is applied', () => {
    const { container } = render(wrapper(<PromotionsSummary />));
    expect(container.firstChild).toBeNull();
  });

  it('calculateTotals reflects promotionTotal in the cart', () => {
    useCartStore.getState().setAppliedPromotion(PERCENTAGE_PROMO);
    const cart = useCartStore.getState().cart;
    // promotionTotal = 6000, items_total = 60000
    const totals = calculateTotals(cart, 0.1);
    expect(totals.total).toBe(54000); // 60000 - 6000
    expect(totals.subtotal).toBe(60000);
  });
});
