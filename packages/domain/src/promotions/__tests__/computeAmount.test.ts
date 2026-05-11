// packages/domain/src/promotions/__tests__/computeAmount.test.ts
import { describe, it, expect } from 'vitest';
import type { Cart, CartItem } from '../../types/index.js';
import type { Promotion, PromotionCatalog } from '../types.js';
import {
  computeBogo,
  computeFixed,
  computeFreeProduct,
  computePercentage,
} from '../computeAmount.js';

function basePromo(over: Partial<Promotion> = {}): Promotion {
  return {
    id: 'p',
    name: 'P',
    slug: 'p',
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
    ...over,
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

const EMPTY_CATALOG: PromotionCatalog = { productCategory: {}, productPrice: {} };

/* ------------------------------ percentage ----------------------------- */

describe('computePercentage', () => {
  it('cart-scope 10% on 100,000 → 10,000', () => {
    const p = basePromo({ scope: 'cart', discount_value: 10 });
    const c = cart([item({ unit_price: 50000, quantity: 2 })]);
    const result = computePercentage(p, c, EMPTY_CATALOG);
    expect(result?.amount).toBe(10000);
    expect(result?.type).toBe('percentage');
  });

  it('caps amount at max_discount_amount', () => {
    const p = basePromo({ scope: 'cart', discount_value: 50, max_discount_amount: 5000 });
    const c = cart([item({ unit_price: 100000, quantity: 1 })]);
    const result = computePercentage(p, c, EMPTY_CATALOG);
    expect(result?.amount).toBe(5000);
  });

  it('returns null when no eligible base', () => {
    const p = basePromo({ scope: 'product', scope_product_ids: ['prod-other'], discount_value: 10 });
    const c = cart([item({ product_id: 'prod-1', unit_price: 50000, quantity: 1 })]);
    expect(computePercentage(p, c, EMPTY_CATALOG)).toBeNull();
  });

  it('product-scope: only matching products contribute', () => {
    const p = basePromo({ scope: 'product', scope_product_ids: ['prod-A'], discount_value: 20 });
    const c = cart([
      item({ id: 'l1', product_id: 'prod-A', unit_price: 30000, quantity: 1 }),
      item({ id: 'l2', product_id: 'prod-B', unit_price: 20000, quantity: 1 }),
    ]);
    const result = computePercentage(p, c, EMPTY_CATALOG);
    expect(result?.amount).toBe(6000); // 20% of 30000
    expect(result?.scope_line_id).toBe('l1'); // single line scope-tagged
  });

  it('category-scope: uses catalog.productCategory mapping', () => {
    const p = basePromo({ scope: 'category', scope_category_ids: ['cat-bev'], discount_value: 10 });
    const catalog: PromotionCatalog = {
      productCategory: { 'prod-A': 'cat-bev', 'prod-B': 'cat-food' },
      productPrice: {},
    };
    const c = cart([
      item({ id: 'l1', product_id: 'prod-A', unit_price: 35000, quantity: 1 }),
      item({ id: 'l2', product_id: 'prod-B', unit_price: 25000, quantity: 1 }),
    ]);
    const result = computePercentage(p, c, catalog);
    expect(result?.amount).toBe(3500);
  });

  it('skips promo gifts in eligible base', () => {
    const p = basePromo({ scope: 'cart', discount_value: 10 });
    const c = cart([
      item({ id: 'l1', unit_price: 50000, quantity: 1 }),
      item({ id: 'g', unit_price: 0, quantity: 1, is_promo_gift: true }),
    ]);
    const result = computePercentage(p, c, EMPTY_CATALOG);
    expect(result?.amount).toBe(5000);
  });

  it('rounds half-up (15% of 33333 → 5000)', () => {
    const p = basePromo({ scope: 'cart', discount_value: 15 });
    const c = cart([item({ unit_price: 33333, quantity: 1 })]);
    const result = computePercentage(p, c, EMPTY_CATALOG);
    expect(result?.amount).toBe(5000);
  });
});

/* ------------------------------- fixed --------------------------------- */

describe('computeFixed', () => {
  it('subtracts a flat 10,000', () => {
    const p = basePromo({ type: 'fixed_amount', scope: 'cart', discount_value: 10000 });
    const c = cart([item({ unit_price: 50000, quantity: 1 })]);
    const result = computeFixed(p, c);
    expect(result?.amount).toBe(10000);
  });

  it('caps at the eligible base', () => {
    const p = basePromo({ type: 'fixed_amount', scope: 'cart', discount_value: 99999 });
    const c = cart([item({ unit_price: 30000, quantity: 1 })]);
    const result = computeFixed(p, c);
    expect(result?.amount).toBe(30000);
  });

  it('returns null when cart is empty', () => {
    const p = basePromo({ type: 'fixed_amount', scope: 'cart', discount_value: 5000 });
    expect(computeFixed(p, cart([]))).toBeNull();
  });
});

/* ------------------------------- BOGO ---------------------------------- */

describe('computeBogo', () => {
  it('buy 2 get 1 free (100% off) on 3 croissants @ 20,000 → 20,000 saving', () => {
    const p = basePromo({
      type: 'bogo',
      scope: null,
      bogo_trigger_product_ids: ['prod-cr'],
      bogo_reward_product_ids: ['prod-cr'],
      bogo_trigger_qty: 2,
      bogo_reward_qty: 1,
      bogo_reward_discount_pct: 100,
    });
    const c = cart([item({ product_id: 'prod-cr', unit_price: 20000, quantity: 3 })]);
    const catalog: PromotionCatalog = {
      productCategory: {},
      productPrice: { 'prod-cr': 20000 },
    };
    const r = computeBogo(p, c, catalog);
    // applications = floor(min(3/2, 3/1)) = 1 → 1 reward × 20000 × 100% = 20000
    expect(r?.amount).toBe(20000);
  });

  it('applies multiple times per spec §7 (5 croissants → 2 applications)', () => {
    const p = basePromo({
      type: 'bogo',
      scope: null,
      bogo_trigger_product_ids: ['prod-cr'],
      bogo_reward_product_ids: ['prod-cr'],
      bogo_trigger_qty: 2,
      bogo_reward_qty: 1,
      bogo_reward_discount_pct: 100,
    });
    const c = cart([item({ product_id: 'prod-cr', unit_price: 20000, quantity: 5 })]);
    const catalog: PromotionCatalog = {
      productCategory: {},
      productPrice: { 'prod-cr': 20000 },
    };
    const r = computeBogo(p, c, catalog);
    // applications = floor(min(5/2, 5/1)) = 2 → 2 × 20000 = 40000
    expect(r?.amount).toBe(40000);
    expect(r?.description).toContain('×2');
  });

  it('cross-product: trigger on A, reward on B at 50% off', () => {
    const p = basePromo({
      type: 'bogo',
      scope: null,
      bogo_trigger_product_ids: ['prod-A'],
      bogo_reward_product_ids: ['prod-B'],
      bogo_trigger_qty: 1,
      bogo_reward_qty: 1,
      bogo_reward_discount_pct: 50,
    });
    const c = cart([
      item({ id: 'l1', product_id: 'prod-A', unit_price: 50000, quantity: 1 }),
      item({ id: 'l2', product_id: 'prod-B', unit_price: 20000, quantity: 1 }),
    ]);
    const catalog: PromotionCatalog = {
      productCategory: {},
      productPrice: { 'prod-A': 50000, 'prod-B': 20000 },
    };
    const r = computeBogo(p, c, catalog);
    // 1 reward × 20000 × 50% = 10000
    expect(r?.amount).toBe(10000);
  });

  it('returns null when not enough triggers', () => {
    const p = basePromo({
      type: 'bogo',
      scope: null,
      bogo_trigger_product_ids: ['prod-cr'],
      bogo_reward_product_ids: ['prod-cr'],
      bogo_trigger_qty: 2,
      bogo_reward_qty: 1,
      bogo_reward_discount_pct: 100,
    });
    const c = cart([item({ product_id: 'prod-cr', unit_price: 20000, quantity: 1 })]);
    const catalog: PromotionCatalog = {
      productCategory: {},
      productPrice: { 'prod-cr': 20000 },
    };
    expect(computeBogo(p, c, catalog)).toBeNull();
  });

  it('skips promo-gift rows from trigger/reward counts', () => {
    const p = basePromo({
      type: 'bogo',
      scope: null,
      bogo_trigger_product_ids: ['prod-cr'],
      bogo_reward_product_ids: ['prod-cr'],
      bogo_trigger_qty: 2,
      bogo_reward_qty: 1,
      bogo_reward_discount_pct: 100,
    });
    const c = cart([
      item({ id: 'l1', product_id: 'prod-cr', unit_price: 20000, quantity: 1 }),
      item({ id: 'g', product_id: 'prod-cr', unit_price: 0, quantity: 5, is_promo_gift: true }),
    ]);
    const catalog: PromotionCatalog = {
      productCategory: {},
      productPrice: { 'prod-cr': 20000 },
    };
    expect(computeBogo(p, c, catalog)).toBeNull();
  });
});

/* ----------------------------- free_product ---------------------------- */

describe('computeFreeProduct', () => {
  it('returns gift_to_add payload', () => {
    const p = basePromo({
      type: 'free_product',
      scope: null,
      gift_product_id: 'prod-cr',
      gift_qty: 1,
      discount_value: null,
    });
    const r = computeFreeProduct(p, cart([]), null);
    expect(r?.amount).toBe(0);
    expect(r?.gift_to_add).toEqual({ product_id: 'prod-cr', qty: 1 });
  });

  it('returns null when gift_product_id missing', () => {
    const p = basePromo({ type: 'free_product', scope: null, gift_product_id: null, discount_value: null });
    expect(computeFreeProduct(p, cart([]), null)).toBeNull();
  });
});
