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
import {
  cartToRpcPayload,
  normalizeV1Payload,
  useEvaluatePromotions,
  zeroGiftDiscountAmount,
} from '../hooks/useEvaluatePromotions';

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
  it('converts RPC shape to AppliedPromotion[] + gift_to_add, zeroing the gift amount', () => {
    // Bug 1 (Session 36): the RPC emits discount_amount AND free_items for a
    // gift-bearing promo. The gift line (unit_price=0) IS the discount, so the
    // monetary amount must be 0 — otherwise the cart subtracts the value twice
    // (over-discount that can exceed the subtotal).
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
    expect(out[0]!.amount).toBe(0);
    expect(out[0]!.free_items).toEqual([{ product_id: 'prod-x', qty: 2 }]);
    expect(out[0]!.gift_to_add).toEqual({ product_id: 'prod-x', qty: 2 });
  });

  it('preserves a monetary amount for non-gift promos (percentage)', () => {
    const out = normalizeV1Payload({
      applied_promotions: [
        { promotion_id: 'p1', slug: 'pct', name: '10% off', type: 'percentage', discount_amount: 10000 },
      ],
      subtotal_before: 100000,
      subtotal_after_discount: 90000,
      total_discount: 10000,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.amount).toBe(10000);
    expect(out[0]!.gift_to_add).toBeUndefined();
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

    expect(rpcMock).toHaveBeenCalledWith('evaluate_promotions_v2', expect.objectContaining({
      p_cart_items: expect.any(Array),
      p_subtotal: 45000,
    }));
    expect(applied).toHaveLength(1);
    // Gift-bearing promo → discount realised by the free line, amount=0.
    expect(applied[0]!.amount).toBe(0);
    expect(applied[0]!.free_items).toEqual([{ product_id: 'prod-baguette', qty: 1 }]);
  });

  it('fallback path: RPC throws → TS engine produces equivalent result', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'network down' } });

    const { result } = renderHook(() => useEvaluatePromotions(), {
      wrapper: withProviders(),
    });

    await waitFor(() => expect(result.current.runEvaluation).toBeTypeOf('function'));

    const applied = await result.current.runEvaluation(CART_3_BAGUETTES, null);

    // Fallback `evaluatePromotionsFallback` evaluates the new-shape BOGO and
    // produces `free_items` (1 baguette). The hook normalises the gift amount
    // to 0 just like the RPC path, so totals never double-count the gift.
    expect(applied).toHaveLength(1);
    expect(applied[0]!.amount).toBe(0);
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

  it('idempotent re-eval: a gift line in the cart is not sent back to the RPC and the amount stays 0', async () => {
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
        subtotal_before: 30000,
        subtotal_after_discount: 30000,
        total_discount: 15000,
      },
      error: null,
    });

    const { result } = renderHook(() => useEvaluatePromotions(), { wrapper: withProviders() });
    await waitFor(() => expect(result.current.runEvaluation).toBeTypeOf('function'));

    // Cart already carries the gift line emitted by a previous evaluation.
    const cartWithGift: Cart = {
      items: [
        { id: 'l1', product_id: 'prod-baguette', name: 'Baguette', unit_price: 15000, quantity: 2, modifiers: [] },
        {
          id: 'gift-p-bogo',
          product_id: 'prod-baguette',
          name: 'Baguette',
          unit_price: 0,
          quantity: 1,
          modifiers: [],
          is_promo_gift: true,
          promotion_id: 'p-bogo',
        },
      ],
      order_type: 'dine_in',
    };

    const first = await result.current.runEvaluation(cartWithGift, null);
    const second = await result.current.runEvaluation(cartWithGift, null);

    // The subtotal sent excludes the gift line (2 × 15000), never 3 × 15000 —
    // this is what stops the discount from accumulating on each pass.
    for (const call of rpcMock.mock.calls) {
      const args = call[1] as { p_cart_items: Array<{ line_id: string }>; p_subtotal: number };
      expect(args.p_subtotal).toBe(30000);
      expect(args.p_cart_items.some((i) => i.line_id === 'gift-p-bogo')).toBe(false);
    }
    // Re-evaluation is idempotent: amount stays 0, gift stable.
    expect(first[0]!.amount).toBe(0);
    expect(second[0]!.amount).toBe(0);
    expect(second).toEqual(first);
  });
});

describe('cartToRpcPayload — gift lines are not fed back into the RPC', () => {
  it('excludes is_promo_gift lines from the payload (Bug 1 accumulation guard)', () => {
    const cart: Cart = {
      items: [
        { id: 'l1', product_id: 'prod-baguette', name: 'Baguette', unit_price: 15000, quantity: 2, modifiers: [] },
        {
          id: 'gift-p',
          product_id: 'prod-baguette',
          name: 'Baguette',
          unit_price: 0,
          quantity: 1,
          modifiers: [],
          is_promo_gift: true,
          promotion_id: 'p',
        },
      ],
      order_type: 'dine_in',
    };
    const payload = cartToRpcPayload(cart);
    expect(payload).toHaveLength(1);
    expect(payload[0]!.line_id).toBe('l1');
    expect(payload.some((p) => p.line_id === 'gift-p')).toBe(false);
  });
});

describe('zeroGiftDiscountAmount', () => {
  it('forces amount to 0 when a gift_to_add is attached', () => {
    const out = zeroGiftDiscountAmount({
      promotion_id: 'p', slug: 's', name: 'n', type: 'free_product', amount: 75000,
      description: 'd', gift_to_add: { product_id: 'x', qty: 1 },
    });
    expect(out.amount).toBe(0);
  });

  it('forces amount to 0 when free_items is non-empty', () => {
    const out = zeroGiftDiscountAmount({
      promotion_id: 'p', slug: 's', name: 'n', type: 'bogo', amount: 15000,
      description: 'd', free_items: [{ product_id: 'x', qty: 1 }],
    });
    expect(out.amount).toBe(0);
  });

  it('leaves a monetary (non-gift) promo untouched', () => {
    const ap = {
      promotion_id: 'p', slug: 's', name: 'n', type: 'percentage' as const,
      amount: 12000, description: 'd',
    };
    expect(zeroGiftDiscountAmount(ap)).toBe(ap);
  });
});
