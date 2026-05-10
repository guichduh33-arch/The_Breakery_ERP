// packages/domain/src/promotions/conditions/__tests__/evaluators.test.ts
import { describe, it, expect } from 'vitest';
import {
  evaluateCartTotalMin,
  evaluateProductInCart,
  evaluateCategoryInCart,
  evaluateCustomerCategoryIn,
  evaluateTimeWindow,
  evaluateWeekdayIn,
  evaluateValidDates,
  evaluateCustomerInLoyaltyTier,
  evaluateFirstOrderOnly,
} from '../evaluators.js';
import type { EvaluationContext } from '../../types.js';

const baseCtx = (overrides: Partial<EvaluationContext> = {}): EvaluationContext => ({
  items: [],
  customer_category_id: null,
  customer_tier: 'Bronze',
  customer_first_order: false,
  evaluation_ts: new Date('2026-05-12T15:00:00+08:00'),
  ...overrides,
});

describe('cart_total_min', () => {
  it('passes when subtotal >= value', () => {
    const ctx = baseCtx({
      items: [{ product_id: 'p', category_id: 'c', qty: 1, unit_price: 50000, modifier_total: 0, manual_discount_amount: 0 }],
    });
    expect(evaluateCartTotalMin(ctx, { type: 'cart_total_min', value: 50000 })).toBe(true);
  });
  it('fails when subtotal < value (49999)', () => {
    const ctx = baseCtx({
      items: [{ product_id: 'p', category_id: 'c', qty: 1, unit_price: 49999, modifier_total: 0, manual_discount_amount: 0 }],
    });
    expect(evaluateCartTotalMin(ctx, { type: 'cart_total_min', value: 50000 })).toBe(false);
  });
});

describe('product_in_cart', () => {
  it('passes when qty >= min_qty', () => {
    const ctx = baseCtx({
      items: [{ product_id: 'P1', category_id: 'c', qty: 2, unit_price: 100, modifier_total: 0, manual_discount_amount: 0 }],
    });
    expect(evaluateProductInCart(ctx, { type: 'product_in_cart', product_id: 'P1', min_qty: 2 })).toBe(true);
  });
  it('fails when product not in cart', () => {
    const ctx = baseCtx({ items: [] });
    expect(evaluateProductInCart(ctx, { type: 'product_in_cart', product_id: 'P1', min_qty: 1 })).toBe(false);
  });
});

describe('category_in_cart', () => {
  it('passes when sum qty for category >= min_qty', () => {
    const ctx = baseCtx({
      items: [
        { product_id: 'P1', category_id: 'CAT1', qty: 1, unit_price: 100, modifier_total: 0, manual_discount_amount: 0 },
        { product_id: 'P2', category_id: 'CAT1', qty: 2, unit_price: 100, modifier_total: 0, manual_discount_amount: 0 },
      ],
    });
    expect(evaluateCategoryInCart(ctx, { type: 'category_in_cart', category_id: 'CAT1', min_qty: 3 })).toBe(true);
  });
});

describe('customer_category_in', () => {
  it('passes when customer category in list', () => {
    const ctx = baseCtx({ customer_category_id: 'VIP' });
    expect(evaluateCustomerCategoryIn(ctx, { type: 'customer_category_in', category_ids: ['VIP', 'STAFF'] })).toBe(true);
  });
  it('fails when customer category null and list does not include null', () => {
    const ctx = baseCtx({ customer_category_id: null });
    expect(evaluateCustomerCategoryIn(ctx, { type: 'customer_category_in', category_ids: ['VIP'] })).toBe(false);
  });
});

describe('time_window', () => {
  it('passes at 15:00 within 14:00-17:00', () => {
    const ctx = baseCtx({ evaluation_ts: new Date('2026-05-12T15:00:00+08:00') });
    expect(evaluateTimeWindow(ctx, { type: 'time_window', start: '14:00', end: '17:00', tz: 'Asia/Jakarta' })).toBe(true);
  });
  it('fails at 13:59', () => {
    const ctx = baseCtx({ evaluation_ts: new Date('2026-05-12T13:59:00+08:00') });
    expect(evaluateTimeWindow(ctx, { type: 'time_window', start: '14:00', end: '17:00', tz: 'Asia/Jakarta' })).toBe(false);
  });
  it('passes inclusively at 14:00 and 17:00', () => {
    const ctx14 = baseCtx({ evaluation_ts: new Date('2026-05-12T14:00:00+07:00') });
    const ctx17 = baseCtx({ evaluation_ts: new Date('2026-05-12T17:00:00+07:00') });
    expect(evaluateTimeWindow(ctx14, { type: 'time_window', start: '14:00', end: '17:00', tz: 'Asia/Jakarta' })).toBe(true);
    expect(evaluateTimeWindow(ctx17, { type: 'time_window', start: '14:00', end: '17:00', tz: 'Asia/Jakarta' })).toBe(true);
  });
});

describe('weekday_in', () => {
  it('passes mardi (dow=2)', () => {
    const ctx = baseCtx({ evaluation_ts: new Date('2026-05-12T10:00:00+08:00') });
    expect(evaluateWeekdayIn(ctx, { type: 'weekday_in', days: [1, 2, 3, 4, 5] })).toBe(true);
  });
  it('fails samedi (dow=6) when only 1-5', () => {
    const ctx = baseCtx({ evaluation_ts: new Date('2026-05-16T10:00:00+08:00') });
    expect(evaluateWeekdayIn(ctx, { type: 'weekday_in', days: [1, 2, 3, 4, 5] })).toBe(false);
  });
});

describe('valid_dates', () => {
  it('passes inclusivement aux bornes', () => {
    const ctx = baseCtx({ evaluation_ts: new Date('2026-01-01T00:00:00+07:00') });
    expect(evaluateValidDates(ctx, { type: 'valid_dates', from: '2026-01-01', until: '2027-01-01' })).toBe(true);
  });
});

describe('customer_in_loyalty_tier', () => {
  it('passes Gold in [Gold, Platinum]', () => {
    const ctx = baseCtx({ customer_tier: 'Gold' });
    expect(evaluateCustomerInLoyaltyTier(ctx, { type: 'customer_in_loyalty_tier', tiers: ['Gold', 'Platinum'] })).toBe(true);
  });
});

describe('first_order_only', () => {
  it('passes when first_order = true', () => {
    const ctx = baseCtx({ customer_first_order: true });
    expect(evaluateFirstOrderOnly(ctx, { type: 'first_order_only' })).toBe(true);
  });
  it('fails when first_order = false', () => {
    const ctx = baseCtx({ customer_first_order: false });
    expect(evaluateFirstOrderOnly(ctx, { type: 'first_order_only' })).toBe(false);
  });
});
