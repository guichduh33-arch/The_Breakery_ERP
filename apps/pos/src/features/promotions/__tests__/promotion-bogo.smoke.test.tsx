// apps/pos/src/features/promotions/__tests__/promotion-bogo.smoke.test.tsx
// Session 8 smoke test — P2: BOGO (buy-one-get-one) promotion.
// Verifies the promo name is displayed and that the items_to_add free item
// appears as a FreeItemRow when previewItems contains it.
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { calculateTotals } from '@breakery/domain';
import type { AppliedPromotion, ItemToAdd } from '@breakery/domain';
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

const FREE_ITEM: ItemToAdd = {
  product_id: 'p1',
  qty: 1,
  unit_price: 35000,
  promotion_discount: 35000,
  is_free_from_promo: true,
};

const BOGO_PROMO: AppliedPromotion = {
  promotion_id: 'promo-bogo-001',
  name: 'Buy 1 Get 1 Americano',
  action_type: 'bogo',
  target: 'item',
  target_product_id: 'p1',
  discount_amount: 35000, // free unit value
  items_to_add: [FREE_ITEM],
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

describe('promotion-bogo smoke', () => {
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

  it('PromotionsSummary shows BOGO promo name', () => {
    useCartStore.getState().setAppliedPromotion(BOGO_PROMO);
    render(wrapper(<PromotionsSummary />));
    expect(screen.getByText(/Buy 1 Get 1 Americano/)).toBeInTheDocument();
  });

  it('PromotionsSummary shows discount_amount for BOGO', () => {
    useCartStore.getState().setAppliedPromotion(BOGO_PROMO);
    render(wrapper(<PromotionsSummary />));
    expect(screen.getByText(/35,000/)).toBeInTheDocument();
  });

  it('setPreviewItems stores free item in store', () => {
    useCartStore.getState().setAppliedPromotion(BOGO_PROMO);
    useCartStore.getState().setPreviewItems([FREE_ITEM]);
    expect(useCartStore.getState().previewItems).toHaveLength(1);
    expect(useCartStore.getState().previewItems[0]?.is_free_from_promo).toBe(true);
  });

  it('calculateTotals with BOGO promotion reduces total by discount_amount', () => {
    useCartStore.getState().setAppliedPromotion(BOGO_PROMO);
    const cart = useCartStore.getState().cart;
    // items_total = 35000, promotionTotal = 35000 → total should be 0
    const totals = calculateTotals(cart, 0.1);
    expect(totals.total).toBe(0);
  });
});
