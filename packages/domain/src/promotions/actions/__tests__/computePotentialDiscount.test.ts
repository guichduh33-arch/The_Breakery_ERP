// packages/domain/src/promotions/actions/__tests__/computePotentialDiscount.test.ts
import { describe, it, expect } from 'vitest';
import { computePotentialDiscount } from '../computePotentialDiscount.js';
import type { Promotion, EvaluationContext } from '../../types.js';

const ctx: EvaluationContext = {
  items: [
    { product_id: 'AMER', category_id: 'BEV', qty: 1, unit_price: 35000, modifier_total: 0, manual_discount_amount: 0 },
    { product_id: 'CROI', category_id: 'BAK', qty: 2, unit_price: 35000, modifier_total: 0, manual_discount_amount: 0 },
  ],
  customer_category_id: null,
  customer_tier: 'Bronze',
  customer_first_order: false,
  evaluation_ts: new Date('2026-05-12T10:00:00+08:00'),
};

const promo = (action_type: Promotion['action_type'], action_params: Record<string, unknown>): Promotion => ({
  id: 'P', name: 'X', slug: 'x', description: null, action_type,
  action_params, conditions: { all: [] }, priority: 0, is_active: true,
});

describe('computePotentialDiscount', () => {
  it('percentage_off cart 20% → 21000 (105k × 0.2)', () => {
    const r = computePotentialDiscount(promo('percentage_off', { percentage: 20, target: 'cart' }), ctx, {});
    expect(r.discount).toBe(21000);
  });
  it('percentage_off category BEV 15% → 5250', () => {
    const r = computePotentialDiscount(
      promo('percentage_off', { percentage: 15, target: 'category', target_id: 'BEV' }),
      ctx, {});
    expect(r.discount).toBe(5250);
  });
  it('fixed_off 5000 cart → 5000 (clamped to subtotal)', () => {
    const r = computePotentialDiscount(promo('fixed_off', { amount: 5000, target: 'cart' }), ctx, {});
    expect(r.discount).toBe(5000);
  });
  it('fixed_off 999999 cart → clamped à 105000', () => {
    const r = computePotentialDiscount(promo('fixed_off', { amount: 999999, target: 'cart' }), ctx, {});
    expect(r.discount).toBe(105000);
  });
  it('bogo CROI 1+1 100% → 35000 + items_to_add', () => {
    const r = computePotentialDiscount(
      promo('bogo', { buy_product_id: 'CROI', buy_qty: 1, get_qty: 1, get_discount_pct: 100 }),
      ctx, { CROI: 35000 });
    expect(r.discount).toBe(35000);
    expect(r.items_to_add).toHaveLength(1);
    expect(r.items_to_add[0]?.is_free_from_promo).toBe(true);
    expect(r.items_to_add[0]?.split_from_existing).toBe(true);
  });
  it('free_product AMER qty 1 → 35000 + items_to_add', () => {
    const r = computePotentialDiscount(
      promo('free_product', { product_id: 'AMER', qty: 1 }),
      ctx, { AMER: 35000 });
    expect(r.discount).toBe(35000);
    expect(r.items_to_add[0]?.split_from_existing).toBe(false);
  });
});
