// packages/domain/src/promotions/__tests__/bogoEngine.test.ts
//
// Session 13 / Phase 2.C — unit tests for the extended promo engine
// (BOGO new shape, threshold, bundle) + fallback orchestrator.
// Mirrors the case matrix used by `supabase/tests/promotions_bogo.test.sql`
// so that the offline-fallback path and the SQL `evaluate_promotions_v1`
// agree on every scenario.

import { describe, it, expect } from 'vitest';
import type { Cart, CartItem } from '../../types/index.js';
import type { Promotion, PromotionCatalog } from '../types.js';
import {
  evaluateBogoNew,
  evaluateBundle,
  evaluatePromotionsFallback,
  evaluateThreshold,
  isNewBogoShape,
} from '../bogoEngine.js';

function basePromo(over: Partial<Promotion> & { id: string }): Promotion {
  const { id, name, slug, ...rest } = over;
  return {
    id,
    name: name ?? `P-${id}`,
    slug: slug ?? id,
    description: null,
    type: 'percentage',
    scope: 'cart',
    discount_value: null,
    max_discount_amount: null,
    scope_product_ids: [],
    scope_category_ids: [],
    bogo_trigger_product_ids: [],
    bogo_reward_product_ids: [],
    bogo_trigger_qty: null,
    bogo_reward_qty: null,
    bogo_reward_discount_pct: null,
    bogo_buy_quantity: null,
    bogo_get_quantity: null,
    bogo_get_product_id: null,
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
    priority: 0,
    stackable_with_promo: false,
    stackable_with_manual: true,
    is_active: true,
    created_at: '2026-05-14T00:00:00.000Z',
    ...rest,
  };
}

function item(over: Partial<CartItem> & { id: string; product_id: string }): CartItem {
  return {
    name: 'Item',
    unit_price: 10000,
    quantity: 1,
    modifiers: [],
    ...over,
  };
}

function cart(items: CartItem[]): Cart {
  return { items, order_type: 'dine_in' };
}

const BAGUETTE_ID = '11111111-1111-1111-1111-111111111111';
const CROISSANT_ID = '22222222-2222-2222-2222-222222222222';
const COFFEE_ID = '33333333-3333-3333-3333-333333333333';
const JUS_ID = '44444444-4444-4444-4444-444444444444';

const NOW = new Date('2026-05-15T12:00:00.000Z');

const catalog: PromotionCatalog = {
  productCategory: {},
  productPrice: {
    [BAGUETTE_ID]: 15_000,
    [CROISSANT_ID]: 20_000,
    [COFFEE_ID]: 25_000,
    [JUS_ID]: 25_000,
  },
};

/* ----------------------------- isNewBogoShape -------------------------- */

describe('isNewBogoShape', () => {
  it('detects fully-configured new shape', () => {
    expect(
      isNewBogoShape(
        basePromo({
          id: 'p1',
          type: 'bogo',
          bogo_buy_quantity: 2,
          bogo_get_quantity: 1,
          bogo_get_product_id: BAGUETTE_ID,
        }),
      ),
    ).toBe(true);
  });

  it('falls back to legacy when any new-shape field is missing', () => {
    expect(
      isNewBogoShape(
        basePromo({
          id: 'p1',
          type: 'bogo',
          bogo_buy_quantity: 2,
          bogo_get_quantity: 1,
          bogo_get_product_id: null,
        }),
      ),
    ).toBe(false);
  });

  it('returns false for non-bogo type', () => {
    expect(
      isNewBogoShape(
        basePromo({
          id: 'p1',
          type: 'threshold',
          bogo_buy_quantity: 2,
          bogo_get_quantity: 1,
          bogo_get_product_id: BAGUETTE_ID,
        }),
      ),
    ).toBe(false);
  });
});

/* --------------------------- evaluateBogoNew --------------------------- */

describe('evaluateBogoNew — buy N get M of product P', () => {
  const promo = basePromo({
    id: 'bogo-2-1-baguette',
    type: 'bogo',
    bogo_buy_quantity: 2,
    bogo_get_quantity: 1,
    bogo_get_product_id: BAGUETTE_ID,
  });

  it('applies once for 2 baguettes (3 in cart → 1 application)', () => {
    const c = cart([item({ id: 'l1', product_id: BAGUETTE_ID, unit_price: 15_000, quantity: 3 })]);
    const out = evaluateBogoNew(promo, c, catalog);
    expect(out).not.toBeNull();
    expect(out!.free_items).toEqual([{ product_id: BAGUETTE_ID, qty: 1 }]);
    expect(out!.amount).toBe(15_000);
    expect(out!.type).toBe('bogo');
  });

  it('applies twice when cart has 5 baguettes (buy 2 ×2 = 4 triggers, 2 free)', () => {
    const c = cart([item({ id: 'l1', product_id: BAGUETTE_ID, unit_price: 15_000, quantity: 5 })]);
    const out = evaluateBogoNew(promo, c, catalog);
    expect(out!.free_items).toEqual([{ product_id: BAGUETTE_ID, qty: 2 }]);
    expect(out!.amount).toBe(30_000);
  });

  it('returns null when fewer than buy quantity in cart', () => {
    const c = cart([item({ id: 'l1', product_id: BAGUETTE_ID, unit_price: 15_000, quantity: 1 })]);
    expect(evaluateBogoNew(promo, c, catalog)).toBeNull();
  });

  it('ignores existing gift lines when counting triggers', () => {
    const c = cart([
      item({ id: 'l1', product_id: BAGUETTE_ID, unit_price: 15_000, quantity: 2 }),
      item({ id: 'l2', product_id: BAGUETTE_ID, unit_price: 0, quantity: 1, is_promo_gift: true }),
    ]);
    const out = evaluateBogoNew(promo, c, catalog);
    expect(out!.free_items![0]!.qty).toBe(1);
    expect(out!.amount).toBe(15_000);
  });

  it('restricts trigger pool when bogo_trigger_product_ids set', () => {
    const restricted = basePromo({
      ...promo,
      id: 'bogo-restricted',
      bogo_trigger_product_ids: [CROISSANT_ID],
    });
    const c = cart([
      item({ id: 'l1', product_id: BAGUETTE_ID, unit_price: 15_000, quantity: 5 }),
      item({ id: 'l2', product_id: CROISSANT_ID, unit_price: 20_000, quantity: 2 }),
    ]);
    const out = evaluateBogoNew(restricted, c, catalog);
    // Only 2 croissants count as triggers → 1 application → 1 free baguette
    expect(out!.free_items).toEqual([{ product_id: BAGUETTE_ID, qty: 1 }]);
  });

  it('returns null if not new shape', () => {
    const legacy = basePromo({ id: 'legacy', type: 'bogo' }); // missing new fields
    const c = cart([item({ id: 'l1', product_id: BAGUETTE_ID, quantity: 5 })]);
    expect(evaluateBogoNew(legacy, c, catalog)).toBeNull();
  });
});

/* --------------------------- evaluateThreshold ------------------------- */

describe('evaluateThreshold', () => {
  it('subtotal threshold 100k @ 10% on 150k cart → 15k discount', () => {
    const promo = basePromo({
      id: 'thr-1',
      type: 'threshold',
      threshold_amount: 100_000,
      threshold_type: 'subtotal',
      discount_value: 10,
      max_discount_amount: 50_000, // signals percent
    });
    const c = cart([item({ id: 'l1', product_id: BAGUETTE_ID, unit_price: 50_000, quantity: 3 })]);
    const out = evaluateThreshold(promo, c);
    expect(out!.amount).toBe(15_000);
    expect(out!.type).toBe('threshold');
  });

  it('subtotal threshold cap respected', () => {
    const promo = basePromo({
      id: 'thr-2',
      type: 'threshold',
      threshold_amount: 100_000,
      threshold_type: 'subtotal',
      discount_value: 50,
      max_discount_amount: 20_000,
    });
    const c = cart([item({ id: 'l1', product_id: BAGUETTE_ID, unit_price: 50_000, quantity: 3 })]);
    const out = evaluateThreshold(promo, c);
    // 50% of 150k = 75k but capped at 20k.
    expect(out!.amount).toBe(20_000);
  });

  it('quantity threshold ≥3 units → fixed 5k off', () => {
    const promo = basePromo({
      id: 'thr-3',
      type: 'threshold',
      threshold_amount: 3,
      threshold_type: 'quantity',
      discount_value: 5_000, // fixed (no max cap set)
    });
    const c = cart([item({ id: 'l1', product_id: BAGUETTE_ID, unit_price: 15_000, quantity: 4 })]);
    const out = evaluateThreshold(promo, c);
    expect(out!.amount).toBe(5_000);
  });

  it('returns null when threshold not met', () => {
    const promo = basePromo({
      id: 'thr-4',
      type: 'threshold',
      threshold_amount: 500_000,
      threshold_type: 'subtotal',
      discount_value: 10,
      max_discount_amount: 100_000,
    });
    const c = cart([item({ id: 'l1', product_id: BAGUETTE_ID, unit_price: 15_000, quantity: 1 })]);
    expect(evaluateThreshold(promo, c)).toBeNull();
  });

  it('returns null when type !== threshold', () => {
    const promo = basePromo({ id: 'thr-skip', type: 'percentage' });
    const c = cart([item({ id: 'l1', product_id: BAGUETTE_ID, quantity: 3 })]);
    expect(evaluateThreshold(promo, c)).toBeNull();
  });
});

/* ----------------------------- evaluateBundle -------------------------- */

describe('evaluateBundle', () => {
  it('applies when all bundle products are in cart', () => {
    const promo = basePromo({
      id: 'bundle-1',
      type: 'bundle',
      bundle_product_ids: [CROISSANT_ID, COFFEE_ID, JUS_ID],
      bundle_price: 50_000,
    });
    const c = cart([
      item({ id: 'l1', product_id: CROISSANT_ID, unit_price: 20_000, quantity: 1 }),
      item({ id: 'l2', product_id: COFFEE_ID, unit_price: 25_000, quantity: 1 }),
      item({ id: 'l3', product_id: JUS_ID, unit_price: 25_000, quantity: 1 }),
    ]);
    const out = evaluateBundle(promo, c, catalog);
    // Matched subtotal = 20+25+25 = 70k. Bundle price = 50k → discount 20k.
    expect(out!.amount).toBe(20_000);
    expect(out!.type).toBe('bundle');
  });

  it('returns null when any bundle product missing', () => {
    const promo = basePromo({
      id: 'bundle-2',
      type: 'bundle',
      bundle_product_ids: [CROISSANT_ID, COFFEE_ID, JUS_ID],
      bundle_price: 50_000,
    });
    const c = cart([
      item({ id: 'l1', product_id: CROISSANT_ID, unit_price: 20_000, quantity: 1 }),
      item({ id: 'l2', product_id: COFFEE_ID, unit_price: 25_000, quantity: 1 }),
    ]);
    expect(evaluateBundle(promo, c, catalog)).toBeNull();
  });

  it('returns null when matched_subtotal ≤ bundle_price', () => {
    const promo = basePromo({
      id: 'bundle-3',
      type: 'bundle',
      bundle_product_ids: [CROISSANT_ID, COFFEE_ID],
      bundle_price: 50_000,
    });
    const c = cart([
      item({ id: 'l1', product_id: CROISSANT_ID, unit_price: 20_000, quantity: 1 }),
      item({ id: 'l2', product_id: COFFEE_ID, unit_price: 25_000, quantity: 1 }),
    ]);
    // sum 45k < bundle_price 50k → no positive discount.
    expect(evaluateBundle(promo, c, catalog)).toBeNull();
  });

  it('rejects bundles of size < 2', () => {
    const promo = basePromo({
      id: 'bundle-4',
      type: 'bundle',
      bundle_product_ids: [CROISSANT_ID],
      bundle_price: 10_000,
    });
    const c = cart([item({ id: 'l1', product_id: CROISSANT_ID, unit_price: 20_000, quantity: 1 })]);
    expect(evaluateBundle(promo, c, catalog)).toBeNull();
  });
});

/* ------------------- evaluatePromotionsFallback (e2e pure) ------------- */

describe('evaluatePromotionsFallback', () => {
  it('integrates BOGO new shape + matchers', () => {
    const promo = basePromo({
      id: 'bogo-int-1',
      type: 'bogo',
      bogo_buy_quantity: 2,
      bogo_get_quantity: 1,
      bogo_get_product_id: BAGUETTE_ID,
      priority: 10,
    });
    const c = cart([item({ id: 'l1', product_id: BAGUETTE_ID, unit_price: 15_000, quantity: 3 })]);
    const applied = evaluatePromotionsFallback([promo], c, null, NOW, catalog);
    expect(applied).toHaveLength(1);
    expect(applied[0]!.free_items![0]!.qty).toBe(1);
  });

  it('skips expired promo (matchers reject)', () => {
    const promo = basePromo({
      id: 'thr-expired',
      type: 'threshold',
      threshold_amount: 50_000,
      threshold_type: 'subtotal',
      discount_value: 10,
      max_discount_amount: 50_000,
      start_at: '2026-01-01T00:00:00.000Z',
      end_at: '2026-02-01T00:00:00.000Z', // before NOW
    });
    const c = cart([item({ id: 'l1', product_id: BAGUETTE_ID, unit_price: 100_000, quantity: 1 })]);
    expect(evaluatePromotionsFallback([promo], c, null, NOW, catalog)).toEqual([]);
  });

  it('applies stacking matrix (anchor + stackable)', () => {
    const p1 = basePromo({
      id: 'p1',
      type: 'percentage',
      scope: 'cart',
      discount_value: 10,
      priority: 100,
      stackable_with_promo: true,
    });
    const p2 = basePromo({
      id: 'p2',
      type: 'threshold',
      threshold_amount: 50_000,
      threshold_type: 'subtotal',
      discount_value: 5_000,
      priority: 50,
      stackable_with_promo: true,
    });
    const c = cart([item({ id: 'l1', product_id: BAGUETTE_ID, unit_price: 100_000, quantity: 1 })]);
    const applied = evaluatePromotionsFallback([p1, p2], c, null, NOW, catalog);
    expect(applied).toHaveLength(2);
    // p1 first (higher priority), p2 stacks because both stackable.
    expect(applied[0]!.promotion_id).toBe('p1');
    expect(applied[1]!.promotion_id).toBe('p2');
  });

  it('drops non-stackable second promo when anchor is non-stackable', () => {
    const p1 = basePromo({
      id: 'p1',
      type: 'percentage',
      scope: 'cart',
      discount_value: 10,
      priority: 100,
      stackable_with_promo: false,
    });
    const p2 = basePromo({
      id: 'p2',
      type: 'threshold',
      threshold_amount: 50_000,
      threshold_type: 'subtotal',
      discount_value: 5_000,
      priority: 50,
      stackable_with_promo: true,
    });
    const c = cart([item({ id: 'l1', product_id: BAGUETTE_ID, unit_price: 100_000, quantity: 1 })]);
    const applied = evaluatePromotionsFallback([p1, p2], c, null, NOW, catalog);
    expect(applied).toHaveLength(1);
    expect(applied[0]!.promotion_id).toBe('p1');
  });

  it('respects dismissedPromotionIds', () => {
    const promo = basePromo({
      id: 'bogo-dismissed',
      type: 'bogo',
      bogo_buy_quantity: 2,
      bogo_get_quantity: 1,
      bogo_get_product_id: BAGUETTE_ID,
    });
    const c = cart([item({ id: 'l1', product_id: BAGUETTE_ID, unit_price: 15_000, quantity: 3 })]);
    const dismissed = new Set(['bogo-dismissed']);
    expect(
      evaluatePromotionsFallback([promo], c, null, NOW, catalog, {
        dismissedPromotionIds: dismissed,
      }),
    ).toEqual([]);
  });

  it('skips inactive promotions', () => {
    const promo = basePromo({
      id: 'bogo-inactive',
      type: 'bogo',
      bogo_buy_quantity: 2,
      bogo_get_quantity: 1,
      bogo_get_product_id: BAGUETTE_ID,
      is_active: false,
    });
    const c = cart([item({ id: 'l1', product_id: BAGUETTE_ID, unit_price: 15_000, quantity: 3 })]);
    expect(evaluatePromotionsFallback([promo], c, null, NOW, catalog)).toEqual([]);
  });
});
