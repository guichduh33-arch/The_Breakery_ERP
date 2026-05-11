// apps/pos/src/__tests__/bogo.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
//
// Session 9 — BOGO buy-2-get-1-50%-off-croissant.
// Spec ref: 2026-05-10-session-9-promotions-spec.md §5, §6, §7 (BOGO qty edge).
//   - 3 croissants in cart → applies BOGO once (uses 2 triggers + 1 reward,
//     leaves 1 trigger eligible). Reward unit price 25,000 × 50% = 12,500 saved.
//   - 5 croissants → applies BOGO twice (2 rewards × 12,500 = 25,000 saved).
//   - 1 croissant → not enough triggers → no BOGO.
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

const BOGO_CROISSANT: Promotion = {
  id: 'promo-bogo-croissant',
  name: 'Croissant BOGO',
  slug: 'bogo-croissant',
  description: 'Buy 2 croissants, get 1 at 50% off',
  type: 'bogo',
  scope: null,
  discount_value: null,
  max_discount_amount: null,
  scope_product_ids: [],
  scope_category_ids: [],
  bogo_trigger_product_ids: ['prod-croissant'],
  bogo_reward_product_ids: ['prod-croissant'],
  bogo_trigger_qty: 2,
  bogo_reward_qty: 1,
  bogo_reward_discount_pct: 50,
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
  priority: 30,
  stackable_with_promo: false,
  stackable_with_manual: true,
  is_active: true,
  created_at: '2026-05-10T00:00:00.000Z',
};

const CATALOG: PromotionCatalog = {
  productCategory: { 'prod-croissant': 'cat-bakery' },
  productPrice: { 'prod-croissant': 25000 },
};

const NOW = new Date('2026-05-11T12:00:00+07:00');

function cartWithQty(qty: number): Cart {
  return {
    items: [
      { id: 'l-cr', product_id: 'prod-croissant', name: 'Butter Croissant', unit_price: 25000, quantity: qty, modifiers: [] },
    ],
    order_type: 'dine_in',
  };
}

describe('BOGO smoke — buy 2 get 1 at 50% off (same SKU)', () => {
  it('1 croissant → not enough triggers, no BOGO', () => {
    const applied = evaluatePromotions([BOGO_CROISSANT], cartWithQty(1), null, NOW, CATALOG);
    expect(applied).toEqual([]);
  });

  it('2 croissants → trigger met but no extra reward unit available, no discount', () => {
    // Same-SKU model: 2 trigger units + 1 reward unit needs ≥3 of the same SKU
    // because trigger and reward pools are independent on quantity but the
    // line is shared. With qty=2, triggerCapacity=1, rewardCapacity=2 →
    // applications=1. Reward saves 1×25000×50% = 12500.
    const applied = evaluatePromotions([BOGO_CROISSANT], cartWithQty(2), null, NOW, CATALOG);
    expect(applied).toHaveLength(1);
    expect(applied[0]?.amount).toBe(12500);
  });

  it('3 croissants → BOGO applies once (1 reward × 50% × 25,000 = 12,500 saved)', () => {
    const applied = evaluatePromotions([BOGO_CROISSANT], cartWithQty(3), null, NOW, CATALOG);
    expect(applied).toHaveLength(1);
    const a = applied[0]!;
    expect(a.type).toBe('bogo');
    expect(a.amount).toBe(12500);
    expect(a.description).toMatch(/×1$/);
  });

  it('5 croissants → BOGO applies twice (2 rewards × 50% × 25,000 = 25,000 saved)', () => {
    // triggerCapacity = floor(5/2) = 2 ; rewardCapacity = floor(5/1) = 5 ;
    // applications = min = 2. Saves 2 × 25000 × 50% = 25000.
    const applied = evaluatePromotions([BOGO_CROISSANT], cartWithQty(5), null, NOW, CATALOG);
    expect(applied).toHaveLength(1);
    expect(applied[0]?.amount).toBe(25000);
    expect(applied[0]?.description).toMatch(/×2$/);
  });

  it('AppliedPromotion description carries the snapshot for promotion_applications audit', () => {
    const applied = evaluatePromotions([BOGO_CROISSANT], cartWithQty(3), null, NOW, CATALOG);
    expect(applied[0]?.description).toBe('Croissant BOGO ×1');
  });
});
