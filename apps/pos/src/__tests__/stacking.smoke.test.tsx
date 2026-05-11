// apps/pos/src/__tests__/stacking.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
//
// Session 9 — promotion stacking matrix.
// Spec ref: 2026-05-10-session-9-promotions-spec.md §1 P11, §5, §6.
//
// Cases:
//   1. Two non-stackable promos eligible → only the higher-priority one applies
//   2. Two stackable promos eligible → both apply (priority order preserved)
//   3. Mixed (high-priority non-stackable + low-priority stackable) →
//      the first wins, the second is skipped because the first isn't stackable
//   4. Tie-break by created_at desc when priority equal
//
import { describe, it, expect, vi } from 'vitest';
import {
  evaluatePromotions,
  type Cart,
  type Promotion,
  type PromotionCatalog,
} from '@breakery/domain';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    from: vi.fn(),
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() })),
    removeChannel: vi.fn(),
  },
  supabaseUrl: 'http://localhost:54321',
}));

// ---------------------------------------------------------------------------
// Fixtures — 4 promotion templates that vary by priority + stackable flags.
// ---------------------------------------------------------------------------

function basePromo(overrides: Partial<Promotion>): Promotion {
  return {
    id: 'promo-x',
    name: 'X',
    slug: 'x',
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
    ...overrides,
  };
}

const PROMO_HIGH_NON_STACK = basePromo({
  id: 'promo-high', slug: 'high', name: 'High Priority 10%', priority: 100,
  stackable_with_promo: false, discount_value: 10,
});
const PROMO_LOW_NON_STACK = basePromo({
  id: 'promo-low', slug: 'low', name: 'Low Priority 5%', priority: 10,
  stackable_with_promo: false, discount_value: 5,
});

const PROMO_HIGH_STACK = basePromo({
  id: 'promo-high-stack', slug: 'high-stack', name: 'High Stackable 10%', priority: 100,
  stackable_with_promo: true, discount_value: 10,
});
const PROMO_LOW_STACK = basePromo({
  id: 'promo-low-stack', slug: 'low-stack', name: 'Low Stackable 5%', priority: 10,
  stackable_with_promo: true, discount_value: 5,
});

const CART: Cart = {
  items: [{ id: 'l1', product_id: 'prod-a', name: 'Item A', unit_price: 100000, quantity: 1, modifiers: [] }],
  order_type: 'dine_in',
};

const CATALOG: PromotionCatalog = {
  productCategory: { 'prod-a': 'cat-a' },
  productPrice: { 'prod-a': 100000 },
};

const NOW = new Date('2026-05-11T12:00:00+07:00');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Stacking smoke — 2 non-stackable promos eligible → only the highest priority applies', () => {
  it('returns 1 applied promotion (the high-priority one)', () => {
    const applied = evaluatePromotions(
      [PROMO_HIGH_NON_STACK, PROMO_LOW_NON_STACK],
      CART, null, NOW, CATALOG,
    );
    expect(applied).toHaveLength(1);
    expect(applied[0]?.promotion_id).toBe(PROMO_HIGH_NON_STACK.id);
    expect(applied[0]?.amount).toBe(10000);
  });

  it('order of input does not matter — sort respects priority desc', () => {
    const applied = evaluatePromotions(
      [PROMO_LOW_NON_STACK, PROMO_HIGH_NON_STACK],
      CART, null, NOW, CATALOG,
    );
    expect(applied).toHaveLength(1);
    expect(applied[0]?.promotion_id).toBe(PROMO_HIGH_NON_STACK.id);
  });
});

describe('Stacking smoke — 2 stackable promos eligible → both apply', () => {
  it('returns 2 applied promotions in priority desc order', () => {
    const applied = evaluatePromotions(
      [PROMO_HIGH_STACK, PROMO_LOW_STACK],
      CART, null, NOW, CATALOG,
    );
    expect(applied).toHaveLength(2);
    expect(applied[0]?.promotion_id).toBe(PROMO_HIGH_STACK.id);
    expect(applied[1]?.promotion_id).toBe(PROMO_LOW_STACK.id);
    expect(applied[0]?.amount).toBe(10000);
    expect(applied[1]?.amount).toBe(5000);
  });
});

describe('Stacking smoke — mixed: top-priority non-stackable blocks subsequent', () => {
  it('non-stackable wins → stackable lower-priority skipped', () => {
    // Highest priority is PROMO_HIGH_NON_STACK (stackable_with_promo=false).
    // PROMO_LOW_STACK has stackable_with_promo=true but is below in priority,
    // so it gets sorted second and the stacking gate filters it out because
    // the FIRST applied promo isn't stackable.
    const applied = evaluatePromotions(
      [PROMO_HIGH_NON_STACK, PROMO_LOW_STACK],
      CART, null, NOW, CATALOG,
    );
    expect(applied).toHaveLength(1);
    expect(applied[0]?.promotion_id).toBe(PROMO_HIGH_NON_STACK.id);
  });
});

describe('Stacking smoke — tie-break by created_at desc when priority is equal', () => {
  it('newer created_at wins on equal priority', () => {
    const older = basePromo({
      id: 'promo-older', slug: 'older', name: 'Older', priority: 50,
      created_at: '2026-01-01T00:00:00.000Z', discount_value: 5,
      stackable_with_promo: false,
    });
    const newer = basePromo({
      id: 'promo-newer', slug: 'newer', name: 'Newer', priority: 50,
      created_at: '2026-04-01T00:00:00.000Z', discount_value: 8,
      stackable_with_promo: false,
    });
    const applied = evaluatePromotions([older, newer], CART, null, NOW, CATALOG);
    expect(applied).toHaveLength(1);
    expect(applied[0]?.promotion_id).toBe(newer.id);
  });
});
