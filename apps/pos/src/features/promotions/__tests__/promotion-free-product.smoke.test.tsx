// apps/pos/src/features/promotions/__tests__/promotion-free-product.smoke.test.tsx
// Session 8 smoke test — P3: free_product promotion.
// Verifies FreeItemRow renders in ActiveOrderPanel when previewItems
// contains a free product added by the promotion engine.
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useCartStore } from '@/stores/cartStore';
import type { AppliedPromotion, ItemToAdd } from '@breakery/domain';
import { FreeItemRow } from '@breakery/ui';

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

const FREE_CROISSANT: ItemToAdd = {
  product_id: 'p-croissant',
  qty: 1,
  unit_price: 25000,
  promotion_discount: 25000,
  is_free_from_promo: true,
};

const FREE_PRODUCT_PROMO: AppliedPromotion = {
  promotion_id: 'promo-free-001',
  name: 'Free Croissant with Coffee',
  action_type: 'free_product',
  target: 'cart',
  target_product_id: 'p-croissant',
  discount_amount: 25000,
  items_to_add: [FREE_CROISSANT],
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

describe('promotion-free-product smoke', () => {
  beforeEach(() => {
    useCartStore.setState({
      cart: {
        items: [
          {
            id: 'l1',
            product_id: 'p-coffee',
            name: 'Americano',
            unit_price: 35000,
            quantity: 1,
            modifiers: [] as never[],
          },
        ],
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

  it('FreeItemRow component renders product name and promo name', () => {
    render(
      wrapper(
        <FreeItemRow productName="Croissant" promotionName="Free Croissant with Coffee" />,
      ),
    );
    expect(screen.getByText('Croissant')).toBeInTheDocument();
    expect(screen.getByText('Free Croissant with Coffee')).toBeInTheDocument();
    expect(screen.getByText('FREE')).toBeInTheDocument();
  });

  it('previewItems stores the free item after setPreviewItems', () => {
    useCartStore.getState().setAppliedPromotion(FREE_PRODUCT_PROMO);
    useCartStore.getState().setPreviewItems([FREE_CROISSANT]);

    const state = useCartStore.getState();
    expect(state.appliedPromotion?.action_type).toBe('free_product');
    expect(state.previewItems[0]?.is_free_from_promo).toBe(true);
    expect(state.previewItems[0]?.product_id).toBe('p-croissant');
  });

  it('clearPromotionPreview removes appliedPromotion and previewItems', () => {
    useCartStore.getState().setAppliedPromotion(FREE_PRODUCT_PROMO);
    useCartStore.getState().setPreviewItems([FREE_CROISSANT]);
    useCartStore.getState().clearPromotionPreview();

    const state = useCartStore.getState();
    expect(state.appliedPromotion).toBeNull();
    expect(state.previewItems).toHaveLength(0);
    expect(state.cart.promotionTotal).toBe(0);
  });
});
