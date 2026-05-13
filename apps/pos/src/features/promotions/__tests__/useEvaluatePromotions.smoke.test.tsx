// apps/pos/src/features/promotions/__tests__/useEvaluatePromotions.smoke.test.tsx
//
// Session 13 / Phase 2.C — smoke tests for the RPC-first promo
// evaluation hook. Mocks `supabase.rpc` so we can assert:
//   1. happy path : RPC returns a v1 payload → hook normalizes it to
//      `AppliedPromotion[]` with `free_items` and `gift_to_add` correctly
//      mapped.
//   2. fallback path : RPC throws → hook falls back to the pure-TS
//      `evaluatePromotionsFallback` and returns its result.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Cart, Promotion } from '@breakery/domain';
import { normalizeV1Payload, useEvaluatePromotions } from '../hooks/useEvaluatePromotions';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() })),
    removeChannel: vi.fn(),
  },
  supabaseUrl: 'http://localhost:54321',
}));

vi.mock('@/features/products/hooks/useProducts', () => ({
  useProducts: () => ({
    data: [
      {
        id: 'prod-baguette',
        name: 'Baguette',
        retail_price: 15000,
        category_id: 'cat-bakery',
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

const PROMO_BOGO_NEW: Promotion = {
  id: 'p-bogo',
  name: 'BOGO 2+1 Baguette',
  slug: 'bogo-2-1-baguette',
  description: null,
  type: 'bogo',
  scope: null,
  discount_value: null,
  max_discount_amount: null,
  scope_product_ids: [],
  scope_category_ids: [],
  bogo_trigger_product_ids: ['prod-baguette'],
  bogo_reward_product_ids: [],
  bogo_trigger_qty: null,
  bogo_reward_qty: null,
  bogo_reward_discount_pct: null,
  bogo_buy_quantity: 2,
  bogo_get_quantity: 1,
  bogo_get_product_id: 'prod-baguette',
  threshold_amount: null,
  threshold_type: null,
  bundle_product_ids: null,
  bundle_price: null,
  gift_product_id: null,
  gift_qty: 1,
  min_items_total: 0,
  customer_category_ids: [],
  customer_tier_ids: [],
  start_at: null,
  end_at: null,
  day_of_week_mask: 127,
  start_hour: null,
  end_hour: null,
  priority: 50,
  stackable_with_promo: false,
  stackable_with_manual: true,
  is_active: true,
  created_at: '2026-05-14T00:00:00.000Z',
};

vi.mock('../hooks/usePromotions', () => ({
  PROMOTIONS_QUERY_KEY: ['promotions', 'active'] as const,
  usePromotions: () => ({
    data: [PROMO_BOGO_NEW],
    isLoading: false,
    error: null,
  }),
}));

const CART_3_BAGUETTES: Cart = {
  items: [
    { id: 'l1', product_id: 'prod-baguette', name: 'Baguette', unit_price: 15000, quantity: 3, modifiers: [] },
  ],
  order_type: 'dine_in',
};

function withProviders() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('normalizeV1Payload', () => {
  it('converts RPC shape to AppliedPromotion[] + gift_to_add', () => {
    const out = normalizeV1Payload({
      applied_promotions: [
        {
          promotion_id: 'p1',
          slug: 'bogo',
          name: 'BOGO',
          type: 'bogo',
          discount_amount: 15000,
          free_items: [{ product_id: 'prod-x', quantity: 2 }],
        },
      ],
      subtotal_before: 45000,
      subtotal_after_discount: 30000,
      total_discount: 15000,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.amount).toBe(15000);
    expect(out[0]!.free_items).toEqual([{ product_id: 'prod-x', qty: 2 }]);
    expect(out[0]!.gift_to_add).toEqual({ product_id: 'prod-x', qty: 2 });
  });

  it('filters dismissedIds', () => {
    const out = normalizeV1Payload(
      {
        applied_promotions: [
          { promotion_id: 'p1', slug: 'a', name: 'A', type: 'percentage', discount_amount: 100 },
          { promotion_id: 'p2', slug: 'b', name: 'B', type: 'percentage', discount_amount: 50 },
        ],
        subtotal_before: 0,
        subtotal_after_discount: 0,
        total_discount: 0,
      },
      new Set(['p1']),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.promotion_id).toBe('p2');
  });
});

describe('useEvaluatePromotions', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('happy path: RPC succeeds → normalized AppliedPromotion[]', async () => {
    rpcMock.mockResolvedValue({
      data: {
        applied_promotions: [
          {
            promotion_id: 'p-bogo',
            slug: 'bogo-2-1-baguette',
            name: 'BOGO 2+1 Baguette',
            type: 'bogo',
            discount_amount: 15000,
            free_items: [{ product_id: 'prod-baguette', quantity: 1 }],
          },
        ],
        subtotal_before: 45000,
        subtotal_after_discount: 30000,
        total_discount: 15000,
      },
      error: null,
    });

    const { result } = renderHook(() => useEvaluatePromotions(), {
      wrapper: withProviders(),
    });

    await waitFor(() => expect(result.current.runEvaluation).toBeTypeOf('function'));

    const applied = await result.current.runEvaluation(CART_3_BAGUETTES, null);

    expect(rpcMock).toHaveBeenCalledWith('evaluate_promotions_v1', expect.objectContaining({
      p_cart_items: expect.any(Array),
      p_subtotal: 45000,
    }));
    expect(applied).toHaveLength(1);
    expect(applied[0]!.amount).toBe(15000);
    expect(applied[0]!.free_items).toEqual([{ product_id: 'prod-baguette', qty: 1 }]);
  });

  it('fallback path: RPC throws → TS engine produces equivalent result', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'network down' } });

    const { result } = renderHook(() => useEvaluatePromotions(), {
      wrapper: withProviders(),
    });

    await waitFor(() => expect(result.current.runEvaluation).toBeTypeOf('function'));

    const applied = await result.current.runEvaluation(CART_3_BAGUETTES, null);

    // Fallback `evaluatePromotionsFallback` evaluates the new-shape BOGO
    // and produces `free_items` + amount equal to 1 × unit_price (15k).
    expect(applied).toHaveLength(1);
    expect(applied[0]!.amount).toBe(15000);
    expect(applied[0]!.free_items![0]!.qty).toBe(1);
  });

  it('returns empty array for empty cart (no RPC call)', async () => {
    const { result } = renderHook(() => useEvaluatePromotions(), {
      wrapper: withProviders(),
    });

    await waitFor(() => expect(result.current.runEvaluation).toBeTypeOf('function'));

    const applied = await result.current.runEvaluation(
      { items: [], order_type: 'dine_in' },
      null,
    );
    expect(applied).toEqual([]);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
