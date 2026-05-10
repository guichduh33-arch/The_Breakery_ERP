// apps/pos/src/__tests__/happy-hour.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
//
// Session 9 — Happy Hour percentage promo on category=beverage, 18h-20h.
// Spec ref: 2026-05-10-session-9-promotions-spec.md §5, §6.
//   - Mock `now` = Monday 18:30 → seed Happy Hour Beverage 10% off
//   - Add Americano (beverage, retail 35,000) → evaluator returns -3,500
//   - Cart panel renders the promo line and the post-promo total
//
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  evaluatePromotions,
  type Cart,
  type Product,
  type Promotion,
  type PromotionCatalog,
} from '@breakery/domain';
import { useCartStore } from '@/stores/cartStore';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

const HAPPY_HOUR_PROMO: Promotion = {
  id: 'promo-happy-hour',
  name: 'Happy Hour Beverage',
  slug: 'happy-hour-bev',
  description: 'Happy Hour 18h-20h — 10% off all beverages',
  type: 'percentage',
  scope: 'category',
  discount_value: 10,
  max_discount_amount: null,
  scope_product_ids: [],
  scope_category_ids: ['cat-bev'],
  bogo_trigger_product_ids: [],
  bogo_reward_product_ids: [],
  bogo_trigger_qty: null,
  bogo_reward_qty: null,
  bogo_reward_discount_pct: null,
  gift_product_id: null,
  gift_qty: 1,
  min_items_total: 0,
  customer_category_ids: [],
  customer_tier_ids: [],
  start_at: null,
  end_at: null,
  day_of_week_mask: 127, // every day
  start_hour: 18,
  end_hour: 20,
  priority: 100,
  stackable_with_promo: false,
  stackable_with_manual: true,
  is_active: true,
  created_at: '2026-05-10T00:00:00.000Z',
};

const AMERICANO: Product = {
  id: 'prod-amer',
  sku: 'BEV-AMER',
  name: 'Americano',
  category_id: 'cat-bev',
  retail_price: 35000,
  wholesale_price: null,
  product_type: 'finished',
  tax_inclusive: true,
  image_url: null,
  current_stock: 10,
  is_active: true,
  is_favorite: true,
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            order: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({ data: [HAPPY_HOUR_PROMO], error: null }),
            })),
          })),
          order: vi.fn(() => ({
            order: vi.fn().mockResolvedValue({ data: [HAPPY_HOUR_PROMO], error: null }),
          })),
        })),
      })),
    })),
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() })),
    removeChannel: vi.fn(),
  },
  supabaseUrl: 'http://localhost:54321',
}));

vi.mock('@/features/products/hooks/useProducts', () => ({
  useProducts: () => ({ data: [AMERICANO], isLoading: false, isSuccess: true }),
}));

vi.mock('@/features/promotions/hooks/usePromotions', () => ({
  usePromotions: () => ({ data: [HAPPY_HOUR_PROMO], isLoading: false, isSuccess: true }),
  PROMOTIONS_QUERY_KEY: ['promotions', 'active'],
}));

// Mock the auto-eval orchestrator + realtime subscription to no-op so the
// pre-populated `appliedPromotions` in cartStore (set in beforeEach below) is
// not overwritten by an evaluator running on the real `Date.now()` (the test
// fixtures simulate Monday 18:30, but real time at run-time may be outside
// the 18-20h Happy Hour window, which would re-evaluate to []).
vi.mock('@/features/promotions/hooks/usePromotionsAutoEval', () => ({
  usePromotionsAutoEval: () => undefined,
}));
vi.mock('@/features/promotions/hooks/usePromotionsRealtime', () => ({
  usePromotionsRealtime: () => undefined,
}));

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

const MONDAY_1830 = new Date('2026-05-11T18:30:00+07:00'); // Monday 18:30 Asia/Jakarta
const MONDAY_2230 = new Date('2026-05-11T22:30:00+07:00'); // outside Happy Hour

// ---------------------------------------------------------------------------
// Tests — evaluator (pure, deterministic)
// ---------------------------------------------------------------------------

describe('Happy Hour smoke — evaluator', () => {
  const cart: Cart = {
    items: [{ id: 'l1', product_id: AMERICANO.id, name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] }],
    order_type: 'dine_in',
  };
  const catalog: PromotionCatalog = {
    productCategory: { [AMERICANO.id]: 'cat-bev' },
    productPrice: { [AMERICANO.id]: 35000 },
  };

  it('within window (Mon 18:30) → applies 10% off, amount=3500', () => {
    const applied = evaluatePromotions([HAPPY_HOUR_PROMO], cart, null, MONDAY_1830, catalog);
    expect(applied).toHaveLength(1);
    expect(applied[0]?.promotion_id).toBe(HAPPY_HOUR_PROMO.id);
    expect(applied[0]?.amount).toBe(3500);
    expect(applied[0]?.type).toBe('percentage');
  });

  it('outside window (Mon 22:30) → no promotion applied', () => {
    const applied = evaluatePromotions([HAPPY_HOUR_PROMO], cart, null, MONDAY_2230, catalog);
    expect(applied).toEqual([]);
  });

  it('non-beverage cart (cat=food) → not eligible', () => {
    const foodCart: Cart = {
      items: [{ id: 'l1', product_id: 'prod-food', name: 'Croissant', unit_price: 25000, quantity: 1, modifiers: [] }],
      order_type: 'dine_in',
    };
    const foodCatalog: PromotionCatalog = {
      productCategory: { 'prod-food': 'cat-food' },
      productPrice: { 'prod-food': 25000 },
    };
    const applied = evaluatePromotions([HAPPY_HOUR_PROMO], foodCart, null, MONDAY_1830, foodCatalog);
    expect(applied).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests — cart panel render (orchestrator + render assertions)
// ---------------------------------------------------------------------------

describe('Happy Hour smoke — cart panel render with applied promo', () => {
  beforeEach(() => {
    // Pre-populate the store with the evaluator output (mirroring what the
    // orchestrator hook would do at Monday 18:30) so the panel render is
    // independent of the debounced effect timing.
    const cart: Cart = {
      items: [{ id: 'l1', product_id: AMERICANO.id, name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] }],
      order_type: 'dine_in',
    };
    const catalog: PromotionCatalog = {
      productCategory: { [AMERICANO.id]: 'cat-bev' },
      productPrice: { [AMERICANO.id]: 35000 },
    };
    const applied = evaluatePromotions([HAPPY_HOUR_PROMO], cart, null, MONDAY_1830, catalog);

    useCartStore.setState({
      cart,
      lockedItemIds: [],
      attachedCustomer: null,
      pickedUpOrderId: null,
      appliedPromotions: applied,
      dismissedPromotionIds: new Set<string>(),
    });
  });

  it('cart panel shows the Happy Hour promo line and -3,500 amount', async () => {
    const { ActiveOrderPanel } = await import('@/features/cart/ActiveOrderPanel');
    render(wrapper(<ActiveOrderPanel />));

    // findByText waits up to 5s — needed because under parallel load the
    // ActiveOrderPanel render + react-query effects can take >1s. The default
    // testTimeout of 5s applies; we raise to 10s explicitly via the third arg.
    expect(await screen.findByText('Happy Hour Beverage', undefined, { timeout: 10000 })).toBeInTheDocument();
    // Promo line shows -Rp 3,500 (the percentage of 35000).
    expect(screen.getAllByText(/Rp\s*3,500/).length).toBeGreaterThan(0);
  }, 15000);
});
