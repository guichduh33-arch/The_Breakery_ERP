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
  it('passes category_in_cart condition', () => {
    expect(isPromotionEligible(baseP({ all: [
      { type: 'category_in_cart', category_id: 'CAT1', min_qty: 1 },
    ]}), ctx)).toBe(true);
  });
  it('passes customer_category_in condition', () => {
    const vipCtx: EvaluationContext = { ...ctx, customer_category_id: 'VIP' };
    expect(isPromotionEligible(baseP({ all: [
      { type: 'customer_category_in', category_ids: ['VIP'] },
    ]}), vipCtx)).toBe(true);
  });
  it('passes time_window condition', () => {
    // 15:00+08:00 = 14:00 Jakarta, within 14:00-17:00
    expect(isPromotionEligible(baseP({ all: [
      { type: 'time_window', start: '14:00', end: '17:00', tz: 'Asia/Jakarta' },
    ]}), ctx)).toBe(true);
  });
  it('passes weekday_in condition for Tuesday', () => {
    // 2026-05-12 is Tuesday (dow=2)
    expect(isPromotionEligible(baseP({ all: [
      { type: 'weekday_in', days: [2] },
    ]}), ctx)).toBe(true);
  });
  it('passes valid_dates condition', () => {
    expect(isPromotionEligible(baseP({ all: [
      { type: 'valid_dates', from: '2026-01-01', until: '2027-01-01' },
    ]}), ctx)).toBe(true);
  });
  it('passes customer_in_loyalty_tier condition', () => {
    const goldCtx: EvaluationContext = { ...ctx, customer_tier: 'Gold' };
    expect(isPromotionEligible(baseP({ all: [
      { type: 'customer_in_loyalty_tier', tiers: ['Gold', 'Platinum'] },
    ]}), goldCtx)).toBe(true);
  });
  it('passes first_order_only condition', () => {
    const firstCtx: EvaluationContext = { ...ctx, customer_first_order: true };
    expect(isPromotionEligible(baseP({ all: [
      { type: 'first_order_only' },
    ]}), firstCtx)).toBe(true);
  });
});
