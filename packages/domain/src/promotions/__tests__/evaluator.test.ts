// packages/domain/src/promotions/__tests__/evaluator.test.ts
import { describe, it, expect } from 'vitest';
import type { Cart, CartItem } from '../../types/index.js';
import type { Promotion, PromotionCatalog } from '../types.js';
import { evaluatePromotions } from '../evaluator.js';

function basePromo(over: Partial<Promotion> & { id: string }): Promotion {
  const { id, name, slug, ...rest } = over;
  return {
    id,
    name: name ?? `P-${id}`,
    slug: slug ?? id,
    description: null,
    type: 'percentage',
    scope: 'cart',
    discount_value: 10,
    max_discount_amount: null,
    scope_product_ids: [],
    scope_category_ids: [],
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
    day_of_week_mask: 127,
    start_hour: null,
    end_hour: null,
    priority: 0,
    stackable_with_promo: false,
    stackable_with_manual: true,
    is_active: true,
    created_at: '2026-05-10T00:00:00.000Z',
    ...rest,
  };
}

function item(over: Partial<CartItem>): CartItem {
  return {
    id: 'l',
    product_id: 'prod-1',
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

const NOW = new Date('2026-05-11T12:00:00');
const EMPTY_CATALOG: PromotionCatalog = { productCategory: {}, productPrice: {} };

/* ----------------------------- priority order -------------------------- */

describe('evaluatePromotions — priority sort', () => {
  it('sorts highest priority first', () => {
    const promos = [
      basePromo({ id: 'low', priority: 10, stackable_with_promo: true, discount_value: 5 }),
      basePromo({ id: 'high', priority: 100, stackable_with_promo: true, discount_value: 10 }),
    ];
    const c = cart([item({ unit_price: 100000, quantity: 1 })]);
    const result = evaluatePromotions(promos, c, null, NOW, EMPTY_CATALOG);
    expect(result.map((r) => r.promotion_id)).toEqual(['high', 'low']);
  });

  it('breaks ties by created_at desc', () => {
    const promos = [
      basePromo({
        id: 'old',
        priority: 50,
        stackable_with_promo: true,
        created_at: '2026-01-01T00:00:00.000Z',
      }),
      basePromo({
        id: 'new',
        priority: 50,
        stackable_with_promo: true,
        created_at: '2026-05-01T00:00:00.000Z',
      }),
    ];
    const c = cart([item({ unit_price: 100000, quantity: 1 })]);
    const result = evaluatePromotions(promos, c, null, NOW, EMPTY_CATALOG);
    expect(result[0]?.promotion_id).toBe('new');
  });
});

/* --------------------------- stacking matrix --------------------------- */

describe('evaluatePromotions — stacking', () => {
  it('non-stackable A wins, B skipped', () => {
    const promos = [
      basePromo({ id: 'A', priority: 100, stackable_with_promo: false, discount_value: 10 }),
      basePromo({ id: 'B', priority: 50, stackable_with_promo: true, discount_value: 5 }),
    ];
    const c = cart([item({ unit_price: 100000, quantity: 1 })]);
    const result = evaluatePromotions(promos, c, null, NOW, EMPTY_CATALOG);
    expect(result.map((r) => r.promotion_id)).toEqual(['A']);
  });

  it('both stackable → both applied in priority order', () => {
    const promos = [
      basePromo({ id: 'A', priority: 100, stackable_with_promo: true, discount_value: 10 }),
      basePromo({ id: 'B', priority: 50, stackable_with_promo: true, discount_value: 5 }),
    ];
    const c = cart([item({ unit_price: 100000, quantity: 1 })]);
    const result = evaluatePromotions(promos, c, null, NOW, EMPTY_CATALOG);
    expect(result.map((r) => r.promotion_id)).toEqual(['A', 'B']);
  });

  it('first stackable but second not → only first applied', () => {
    const promos = [
      basePromo({ id: 'A', priority: 100, stackable_with_promo: true, discount_value: 10 }),
      basePromo({ id: 'B', priority: 50, stackable_with_promo: false, discount_value: 5 }),
    ];
    const c = cart([item({ unit_price: 100000, quantity: 1 })]);
    const result = evaluatePromotions(promos, c, null, NOW, EMPTY_CATALOG);
    expect(result.map((r) => r.promotion_id)).toEqual(['A']);
  });
});

/* ------------------------- eligibility filter -------------------------- */

describe('evaluatePromotions — eligibility filter', () => {
  it('drops inactive promos', () => {
    const promos = [basePromo({ id: 'A', is_active: false })];
    const c = cart([item({ unit_price: 50000, quantity: 1 })]);
    expect(evaluatePromotions(promos, c, null, NOW, EMPTY_CATALOG)).toHaveLength(0);
  });

  it('drops promos failing date range', () => {
    const promos = [basePromo({ id: 'A', start_at: '2030-01-01T00:00:00Z' })];
    const c = cart([item({ unit_price: 50000, quantity: 1 })]);
    expect(evaluatePromotions(promos, c, null, NOW, EMPTY_CATALOG)).toHaveLength(0);
  });

  it('drops promos in dismissedPromotionIds', () => {
    const promos = [basePromo({ id: 'A', discount_value: 10 })];
    const c = cart([item({ unit_price: 50000, quantity: 1 })]);
    const result = evaluatePromotions(
      promos,
      c,
      null,
      NOW,
      EMPTY_CATALOG,
      { dismissedPromotionIds: new Set(['A']) },
    );
    expect(result).toHaveLength(0);
  });
});

/* ----------------------------- gift add/remove ------------------------- */

describe('evaluatePromotions — free_product gift', () => {
  it('returns AppliedPromotion with gift_to_add when conditions met', () => {
    const promos = [
      basePromo({
        id: 'gift',
        type: 'free_product',
        scope: null,
        discount_value: null,
        gift_product_id: 'prod-cr',
        gift_qty: 1,
        min_items_total: 100_000,
      }),
    ];
    const c = cart([item({ unit_price: 110_000, quantity: 1 })]);
    const result = evaluatePromotions(promos, c, null, NOW, EMPTY_CATALOG);
    expect(result).toHaveLength(1);
    expect(result[0]?.gift_to_add).toEqual({ product_id: 'prod-cr', qty: 1 });
  });

  it('drops gift promo when condition no longer met', () => {
    const promos = [
      basePromo({
        id: 'gift',
        type: 'free_product',
        scope: null,
        discount_value: null,
        gift_product_id: 'prod-cr',
        gift_qty: 1,
        min_items_total: 100_000,
      }),
    ];
    const c = cart([item({ unit_price: 90_000, quantity: 1 })]);
    expect(evaluatePromotions(promos, c, null, NOW, EMPTY_CATALOG)).toHaveLength(0);
  });

  it('respects dismissedPromotionIds for gift (re-eval skip)', () => {
    const promos = [
      basePromo({
        id: 'gift',
        type: 'free_product',
        scope: null,
        discount_value: null,
        gift_product_id: 'prod-cr',
        gift_qty: 1,
        min_items_total: 0,
      }),
    ];
    const c = cart([item({ unit_price: 50_000, quantity: 1 })]);
    const result = evaluatePromotions(
      promos,
      c,
      null,
      NOW,
      EMPTY_CATALOG,
      { dismissedPromotionIds: new Set(['gift']) },
    );
    expect(result).toHaveLength(0);
  });
});

/* ----------------------------- mixed scenarios ------------------------- */

describe('evaluatePromotions — mixed scenarios', () => {
  it('Happy Hour 18-20 + percentage cart, both stackable', () => {
    const promos = [
      basePromo({
        id: 'happy',
        priority: 100,
        stackable_with_promo: true,
        scope: 'category',
        scope_category_ids: ['cat-bev'],
        discount_value: 10,
        start_hour: 18,
        end_hour: 20,
      }),
      basePromo({
        id: 'cart',
        priority: 10,
        stackable_with_promo: true,
        scope: 'cart',
        discount_value: 5,
      }),
    ];
    const catalog: PromotionCatalog = {
      productCategory: { 'prod-bev': 'cat-bev' },
      productPrice: {},
    };
    const c = cart([item({ product_id: 'prod-bev', unit_price: 35000, quantity: 1 })]);
    const evening = new Date('2026-05-11T18:30:00');
    const result = evaluatePromotions(promos, c, null, evening, catalog);
    expect(result.map((r) => r.promotion_id)).toEqual(['happy', 'cart']);
    expect(result[0]?.amount).toBe(3500);
  });

  it('returns empty array when no promos match', () => {
    const promos = [
      basePromo({ id: 'A', start_hour: 18, end_hour: 20 }),
    ];
    const c = cart([item({ unit_price: 100000, quantity: 1 })]);
    const noon = new Date('2026-05-11T12:00:00');
    expect(evaluatePromotions(promos, c, null, noon, EMPTY_CATALOG)).toHaveLength(0);
  });
});
