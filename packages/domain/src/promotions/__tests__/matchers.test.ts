// packages/domain/src/promotions/__tests__/matchers.test.ts
import { describe, it, expect } from 'vitest';
import type { Cart, CartItem } from '../../types/index.js';
import type { Promotion, PromotionCustomer } from '../types.js';
import {
  matchAllConditions,
  matchCustomerCategory,
  matchCustomerTier,
  matchDateRange,
  matchDayOfWeek,
  matchHour,
  matchMinTotal,
} from '../matchers.js';

/* ----------------------------- fixtures -------------------------------- */

function basePromo(over: Partial<Promotion> = {}): Promotion {
  return {
    id: 'p-1',
    name: 'Test',
    slug: 'test',
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

function cartWith(items: CartItem[]): Cart {
  return { items, order_type: 'dine_in' };
}

function item(over: Partial<CartItem> = {}): CartItem {
  return {
    id: 'l-1',
    product_id: 'prod-1',
    name: 'Item',
    unit_price: 10000,
    quantity: 1,
    modifiers: [],
    ...over,
  };
}

/* ----------------------------- matchDateRange -------------------------- */

describe('matchDateRange', () => {
  it('returns true when both bounds are null (always-on promo)', () => {
    const p = basePromo({ start_at: null, end_at: null });
    expect(matchDateRange(p, new Date('2026-05-10T12:00:00Z'))).toBe(true);
  });

  it('returns true when now is inside the window', () => {
    const p = basePromo({
      start_at: '2026-05-01T00:00:00Z',
      end_at: '2026-05-31T23:59:59Z',
    });
    expect(matchDateRange(p, new Date('2026-05-15T12:00:00Z'))).toBe(true);
  });

  it('returns false when now is before start_at', () => {
    const p = basePromo({ start_at: '2026-06-01T00:00:00Z' });
    expect(matchDateRange(p, new Date('2026-05-31T23:59:59Z'))).toBe(false);
  });

  it('returns false when now is after end_at', () => {
    const p = basePromo({ end_at: '2026-05-09T23:59:59Z' });
    expect(matchDateRange(p, new Date('2026-05-10T00:00:00Z'))).toBe(false);
  });

  it('returns true exactly at start_at boundary (inclusive)', () => {
    const p = basePromo({ start_at: '2026-05-10T00:00:00Z' });
    expect(matchDateRange(p, new Date('2026-05-10T00:00:00Z'))).toBe(true);
  });

  it('returns false on malformed start_at', () => {
    const p = basePromo({ start_at: 'not-a-date' });
    expect(matchDateRange(p, new Date('2026-05-10T00:00:00Z'))).toBe(false);
  });
});

/* ----------------------------- matchDayOfWeek -------------------------- */

describe('matchDayOfWeek', () => {
  it('mask 127 matches every day', () => {
    const p = basePromo({ day_of_week_mask: 127 });
    // Sunday 2026-05-10, Monday 2026-05-11, ...
    for (let d = 10; d <= 16; d++) {
      expect(matchDayOfWeek(p, new Date(`2026-05-${d}T12:00:00`))).toBe(true);
    }
  });

  it('mask 0 matches no day', () => {
    const p = basePromo({ day_of_week_mask: 0 });
    expect(matchDayOfWeek(p, new Date('2026-05-11T12:00:00'))).toBe(false);
  });

  it('matches only Mondays when mask=1 (bit 0 = Mon)', () => {
    const p = basePromo({ day_of_week_mask: 1 });
    // 2026-05-11 is a Monday
    expect(matchDayOfWeek(p, new Date('2026-05-11T12:00:00'))).toBe(true);
    // 2026-05-12 is a Tuesday
    expect(matchDayOfWeek(p, new Date('2026-05-12T12:00:00'))).toBe(false);
  });

  it('matches only Sundays when mask=64 (bit 6 = Sun)', () => {
    const p = basePromo({ day_of_week_mask: 64 });
    // 2026-05-10 is a Sunday
    expect(matchDayOfWeek(p, new Date('2026-05-10T12:00:00'))).toBe(true);
    // 2026-05-11 is a Monday
    expect(matchDayOfWeek(p, new Date('2026-05-11T12:00:00'))).toBe(false);
  });

  it('matches weekdays-only when mask=31 (Mon..Fri = bits 0..4)', () => {
    const p = basePromo({ day_of_week_mask: 31 });
    expect(matchDayOfWeek(p, new Date('2026-05-11T12:00:00'))).toBe(true); // Mon
    expect(matchDayOfWeek(p, new Date('2026-05-15T12:00:00'))).toBe(true); // Fri
    expect(matchDayOfWeek(p, new Date('2026-05-16T12:00:00'))).toBe(false); // Sat
    expect(matchDayOfWeek(p, new Date('2026-05-10T12:00:00'))).toBe(false); // Sun
  });
});

/* ----------------------------- matchHour ------------------------------- */

describe('matchHour', () => {
  it('matches all hours when both bounds null', () => {
    const p = basePromo({ start_hour: null, end_hour: null });
    expect(matchHour(p, new Date('2026-05-11T03:00:00'))).toBe(true);
    expect(matchHour(p, new Date('2026-05-11T23:30:00'))).toBe(true);
  });

  it('matches inside happy-hour window 18..20', () => {
    const p = basePromo({ start_hour: 18, end_hour: 20 });
    expect(matchHour(p, new Date('2026-05-11T18:00:00'))).toBe(true);
    expect(matchHour(p, new Date('2026-05-11T18:30:00'))).toBe(true);
    expect(matchHour(p, new Date('2026-05-11T19:59:59'))).toBe(true);
  });

  it('does not match at end_hour boundary (half-open)', () => {
    const p = basePromo({ start_hour: 18, end_hour: 20 });
    expect(matchHour(p, new Date('2026-05-11T20:00:00'))).toBe(false);
  });

  it('does not match before start_hour', () => {
    const p = basePromo({ start_hour: 18, end_hour: 20 });
    expect(matchHour(p, new Date('2026-05-11T17:59:59'))).toBe(false);
  });

  it('returns false if only one bound set', () => {
    const p = basePromo({ start_hour: 18, end_hour: null });
    expect(matchHour(p, new Date('2026-05-11T19:00:00'))).toBe(false);
  });
});

/* ----------------------------- matchMinTotal --------------------------- */

describe('matchMinTotal', () => {
  it('returns true when min_items_total is 0', () => {
    const p = basePromo({ min_items_total: 0 });
    expect(matchMinTotal(p, cartWith([]))).toBe(true);
  });

  it('matches when items_total clears the threshold', () => {
    const p = basePromo({ min_items_total: 50_000 });
    const c = cartWith([item({ unit_price: 30000, quantity: 2 })]);
    expect(matchMinTotal(p, c)).toBe(true);
  });

  it('rejects when items_total is below threshold', () => {
    const p = basePromo({ min_items_total: 100_000 });
    const c = cartWith([item({ unit_price: 30000, quantity: 2 })]);
    expect(matchMinTotal(p, c)).toBe(false);
  });

  it('excludes promo gifts from the total', () => {
    // Gift line shouldn't push the total over the threshold (anti-bootstrap).
    const p = basePromo({ min_items_total: 100_000 });
    const c = cartWith([
      item({ id: 'l-1', unit_price: 95_000, quantity: 1 }),
      item({ id: 'l-gift', unit_price: 0, quantity: 1, is_promo_gift: true }),
    ]);
    expect(matchMinTotal(p, c)).toBe(false);
  });
});

/* ----------------------------- customer matchers ----------------------- */

describe('matchCustomerCategory', () => {
  it('returns true when promo has no category restriction', () => {
    const p = basePromo({ customer_category_ids: [] });
    expect(matchCustomerCategory(p, null)).toBe(true);
  });

  it('returns false when restricted but no customer attached', () => {
    const p = basePromo({ customer_category_ids: ['cat-vip'] });
    expect(matchCustomerCategory(p, null)).toBe(false);
  });

  it('returns true when customer category is in the list', () => {
    const p = basePromo({ customer_category_ids: ['cat-vip', 'cat-wholesale'] });
    const c: PromotionCustomer = { id: 'c1', category_id: 'cat-vip' };
    expect(matchCustomerCategory(p, c)).toBe(true);
  });

  it('returns false when customer category is not in the list', () => {
    const p = basePromo({ customer_category_ids: ['cat-vip'] });
    const c: PromotionCustomer = { id: 'c1', category_id: 'cat-retail' };
    expect(matchCustomerCategory(p, c)).toBe(false);
  });
});

describe('matchCustomerTier', () => {
  it('returns true with empty tier list', () => {
    expect(matchCustomerTier(basePromo({ customer_tier_ids: [] }), null)).toBe(true);
  });

  it('returns true when tier matches', () => {
    const p = basePromo({ customer_tier_ids: ['tier-gold'] });
    expect(matchCustomerTier(p, { id: 'c1', tier_id: 'tier-gold' })).toBe(true);
  });

  it('returns false when tier missing on customer', () => {
    const p = basePromo({ customer_tier_ids: ['tier-gold'] });
    expect(matchCustomerTier(p, { id: 'c1', tier_id: null })).toBe(false);
  });
});

/* ----------------------------- matchAllConditions ---------------------- */

describe('matchAllConditions', () => {
  it('passes when every matcher passes', () => {
    const p = basePromo();
    expect(matchAllConditions(p, cartWith([]), null, new Date('2026-05-11T18:00:00'))).toBe(true);
  });

  it('fails when one matcher fails', () => {
    const p = basePromo({ start_hour: 18, end_hour: 20 });
    expect(matchAllConditions(p, cartWith([]), null, new Date('2026-05-11T17:00:00'))).toBe(false);
  });
});
