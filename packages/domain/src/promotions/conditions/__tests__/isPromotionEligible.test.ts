// packages/domain/src/promotions/conditions/__tests__/isPromotionEligible.test.ts
import { describe, it, expect } from 'vitest';
import { isPromotionEligible } from '../isPromotionEligible.js';
import type { EvaluationContext, Promotion } from '../../types.js';

const ctx: EvaluationContext = {
  items: [{ product_id: 'P1', category_id: 'CAT1', qty: 1, unit_price: 50000, modifier_total: 0, manual_discount_amount: 0 }],
  customer_category_id: null,
  customer_tier: 'Bronze',
  customer_first_order: false,
  evaluation_ts: new Date('2026-05-12T15:00:00+08:00'),
};

const baseP = (conditions: Promotion['conditions'] = { all: [] }): Promotion => ({
  id: 'P', name: 'X', slug: 'x', description: null, action_type: 'fixed_off',
  action_params: {}, conditions, priority: 0, is_active: true,
});

describe('isPromotionEligible', () => {
  it('returns true with empty conditions (vacuously true)', () => {
    expect(isPromotionEligible(baseP({ all: [] }), ctx)).toBe(true);
  });
  it('returns true when all conditions pass', () => {
    expect(isPromotionEligible(baseP({ all: [
      { type: 'cart_total_min', value: 30000 },
      { type: 'product_in_cart', product_id: 'P1', min_qty: 1 },
    ]}), ctx)).toBe(true);
  });
  it('returns false if any condition fails', () => {
    expect(isPromotionEligible(baseP({ all: [
      { type: 'cart_total_min', value: 30000 },
      { type: 'cart_total_min', value: 99999 },
    ]}), ctx)).toBe(false);
  });
});
