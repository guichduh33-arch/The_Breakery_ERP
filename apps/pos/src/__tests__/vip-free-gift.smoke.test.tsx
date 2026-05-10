// apps/pos/src/__tests__/vip-free-gift.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
//
// Session 9 — VIP Free Croissant gift on cart ≥ 100k IDR.
// Spec ref: 2026-05-10-session-9-promotions-spec.md §5, §6, §7 (anti-loop).
//   - VIP customer attached + items totaling 110k → gift croissant auto-added
//     at unit_price=0, is_promo_gift=true, promotion_id set
//   - Drop items below 100k → gift auto-removed via `setAppliedPromotions`
//   - User manually removes gift line → promotion_id added to dismissed set ;
//     subsequent re-eval is skipped for that promo (no immediate re-add).
//
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  evaluatePromotions,
  type Cart,
  type Promotion,
  type PromotionCatalog,
  type PromotionCustomer,
} from '@breakery/domain';
import { useCartStore } from '@/stores/cartStore';
import type { CustomerWithCategory } from '@/stores/cartStore';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) })) })),
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() })),
    removeChannel: vi.fn(),
  },
  supabaseUrl: 'http://localhost:54321',
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VIP_FREE_CROISSANT: Promotion = {
  id: 'promo-vip-croissant',
  name: 'VIP Free Croissant',
  slug: 'vip-free-croissant',
  description: 'VIP customers — free croissant on orders ≥ 100,000 IDR',
  type: 'free_product',
  scope: null,
  discount_value: null,
  max_discount_amount: null,
  scope_product_ids: [],
  scope_category_ids: [],
  bogo_trigger_product_ids: [],
  bogo_reward_product_ids: [],
  bogo_trigger_qty: null,
  bogo_reward_qty: null,
  bogo_reward_discount_pct: null,
  gift_product_id: 'prod-croissant',
  gift_qty: 1,
  min_items_total: 100000,
  customer_category_ids: ['cat-vip'],
  customer_tier_ids: [],
  start_at: null,
  end_at: null,
  day_of_week_mask: 127,
  start_hour: null,
  end_hour: null,
  priority: 50,
  stackable_with_promo: true,
  stackable_with_manual: true,
  is_active: true,
  created_at: '2026-05-10T00:00:00.000Z',
};

const VIP_CUSTOMER: CustomerWithCategory = {
  id: 'cust-vip-001',
  name: 'VIP Member',
  phone: '+62812222',
  email: null,
  customer_type: 'retail',
  loyalty_points: 0,
  lifetime_points: 0,
  total_spent: 0,
  total_visits: 0,
  last_visit_at: null,
  category: {
    id: 'cat-vip',
    name: 'VIP',
    slug: 'vip',
    color: '#F59E0B',
    icon: null,
    price_modifier_type: 'discount_percentage',
    discount_percentage: 0,
    loyalty_enabled: true,
    points_multiplier: 1.0,
    is_default: false,
  },
};

const VIP_PROMO_CUSTOMER: PromotionCustomer = {
  id: VIP_CUSTOMER.id,
  category_id: VIP_CUSTOMER.category!.id,
};

const CATALOG: PromotionCatalog = {
  productCategory: {
    'prod-amer': 'cat-bev',
    'prod-croissant': 'cat-bakery',
  },
  productPrice: {
    'prod-amer': 35000,
    'prod-croissant': 25000,
  },
};

const PRODUCT_LOOKUP = { 'prod-croissant': { name: 'Butter Croissant' } };

const ITEMS_OVER_100K = [
  { id: 'l1', product_id: 'prod-amer', name: 'Americano', unit_price: 60000, quantity: 1, modifiers: [] },
  { id: 'l2', product_id: 'prod-croissant', name: 'Butter Croissant', unit_price: 25000, quantity: 2, modifiers: [] },
];
// items_total = 60000 + 50000 = 110000 ≥ 100000 → VIP gift triggers

const ITEMS_UNDER_100K = [
  { id: 'l1', product_id: 'prod-amer', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] },
  { id: 'l2', product_id: 'prod-croissant', name: 'Butter Croissant', unit_price: 25000, quantity: 1, modifiers: [] },
];
// items_total = 35000 + 25000 = 60000 < 100000 → gift dropped

const NOW = new Date('2026-05-11T12:00:00+07:00'); // any time, no hour restriction

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VIP Free Gift smoke — eligibility evaluator', () => {
  it('VIP customer + items ≥ 100k → gift_to_add returned', () => {
    const cart: Cart = { items: ITEMS_OVER_100K, order_type: 'dine_in' };
    const applied = evaluatePromotions([VIP_FREE_CROISSANT], cart, VIP_PROMO_CUSTOMER, NOW, CATALOG);
    expect(applied).toHaveLength(1);
    expect(applied[0]?.gift_to_add).toEqual({ product_id: 'prod-croissant', qty: 1 });
    expect(applied[0]?.amount).toBe(0);
  });

  it('VIP customer + items < 100k → no gift', () => {
    const cart: Cart = { items: ITEMS_UNDER_100K, order_type: 'dine_in' };
    const applied = evaluatePromotions([VIP_FREE_CROISSANT], cart, VIP_PROMO_CUSTOMER, NOW, CATALOG);
    expect(applied).toEqual([]);
  });

  it('non-VIP customer + items ≥ 100k → no gift', () => {
    const cart: Cart = { items: ITEMS_OVER_100K, order_type: 'dine_in' };
    const applied = evaluatePromotions([VIP_FREE_CROISSANT], cart, { id: 'cust-other', category_id: 'cat-retail' }, NOW, CATALOG);
    expect(applied).toEqual([]);
  });

  it('no customer attached + items ≥ 100k → no gift (matchCustomerCategory denies)', () => {
    const cart: Cart = { items: ITEMS_OVER_100K, order_type: 'dine_in' };
    const applied = evaluatePromotions([VIP_FREE_CROISSANT], cart, null, NOW, CATALOG);
    expect(applied).toEqual([]);
  });
});

describe('VIP Free Gift smoke — cart store gift sync', () => {
  beforeEach(() => {
    useCartStore.setState({
      cart: { items: ITEMS_OVER_100K, order_type: 'dine_in', customerId: VIP_CUSTOMER.id },
      lockedItemIds: [],
      attachedCustomer: VIP_CUSTOMER,
      pickedUpOrderId: null,
      appliedPromotions: [],
      dismissedPromotionIds: new Set<string>(),
    });
  });

  it('setAppliedPromotions auto-adds a gift line at unit_price=0 with is_promo_gift=true', () => {
    const applied = evaluatePromotions(
      [VIP_FREE_CROISSANT],
      useCartStore.getState().cart,
      VIP_PROMO_CUSTOMER,
      NOW,
      CATALOG,
    );
    expect(applied).toHaveLength(1);

    const result = useCartStore.getState().setAppliedPromotions(applied, PRODUCT_LOOKUP);

    const items = useCartStore.getState().cart.items;
    const giftLine = items.find((i) => i.is_promo_gift === true);
    expect(giftLine).toBeDefined();
    expect(giftLine?.unit_price).toBe(0);
    expect(giftLine?.quantity).toBe(1);
    expect(giftLine?.product_id).toBe('prod-croissant');
    expect(giftLine?.promotion_id).toBe(VIP_FREE_CROISSANT.id);
    expect(giftLine?.name).toBe('Butter Croissant');

    expect(result.addedGifts).toHaveLength(1);
    expect(result.addedGifts[0]?.name).toBe('Butter Croissant');
    expect(result.removedGifts).toEqual([]);
  });

  it('cart drops below 100k → setAppliedPromotions auto-removes the gift line', () => {
    // 1. First, plant a gift line as if a previous eval added it.
    useCartStore.getState().setAppliedPromotions(
      evaluatePromotions(
        [VIP_FREE_CROISSANT],
        useCartStore.getState().cart,
        VIP_PROMO_CUSTOMER,
        NOW,
        CATALOG,
      ),
      PRODUCT_LOOKUP,
    );
    expect(useCartStore.getState().cart.items.some((i) => i.is_promo_gift)).toBe(true);

    // 2. Mutate the cart down (replace items but keep gift line as if user
    //    removed regular items via update/remove).
    useCartStore.setState((s) => ({
      cart: {
        ...s.cart,
        items: [
          ...ITEMS_UNDER_100K,
          // Pretend the gift line is still there from the prior sync.
          ...s.cart.items.filter((i) => i.is_promo_gift),
        ],
      },
    }));

    // 3. Re-evaluate ; gift no longer eligible (under 100k).
    const next = evaluatePromotions(
      [VIP_FREE_CROISSANT],
      useCartStore.getState().cart,
      VIP_PROMO_CUSTOMER,
      NOW,
      CATALOG,
    );
    expect(next).toEqual([]);

    const result = useCartStore.getState().setAppliedPromotions(next, PRODUCT_LOOKUP);
    expect(result.removedGifts).toHaveLength(1);
    expect(result.removedGifts[0]?.name).toBe('Butter Croissant');

    // Gift line wiped from cart.
    expect(useCartStore.getState().cart.items.some((i) => i.is_promo_gift)).toBe(false);
  });

  it('user manually removes gift line → promotion_id added to dismissed set + appliedPromotions filtered', () => {
    // 1. Auto-add gift via setAppliedPromotions.
    useCartStore.getState().setAppliedPromotions(
      evaluatePromotions(
        [VIP_FREE_CROISSANT],
        useCartStore.getState().cart,
        VIP_PROMO_CUSTOMER,
        NOW,
        CATALOG,
      ),
      PRODUCT_LOOKUP,
    );
    const giftId = useCartStore.getState().cart.items.find((i) => i.is_promo_gift)!.id;
    expect(useCartStore.getState().dismissedPromotionIds.size).toBe(0);

    // 2. User taps trash on the gift line.
    useCartStore.getState().remove(giftId);

    // dismissedPromotionIds now contains the promo id
    expect(useCartStore.getState().dismissedPromotionIds.has(VIP_FREE_CROISSANT.id)).toBe(true);
    // and appliedPromotions is filtered for that promo
    expect(useCartStore.getState().appliedPromotions.some((ap) => ap.promotion_id === VIP_FREE_CROISSANT.id)).toBe(false);
    // line removed from cart
    expect(useCartStore.getState().cart.items.some((i) => i.is_promo_gift)).toBe(false);

    // 3. Re-evaluator with dismissed set → skip the promo, no re-add (anti-loop).
    const next = evaluatePromotions(
      [VIP_FREE_CROISSANT],
      useCartStore.getState().cart,
      VIP_PROMO_CUSTOMER,
      NOW,
      CATALOG,
      { dismissedPromotionIds: useCartStore.getState().dismissedPromotionIds },
    );
    expect(next).toEqual([]);
  });

  it('clear() resets dismissedPromotionIds and appliedPromotions', () => {
    useCartStore.setState((s) => ({
      ...s,
      dismissedPromotionIds: new Set(['promo-xyz']),
      appliedPromotions: [{ promotion_id: 'promo-xyz', slug: 'x', name: 'x', type: 'percentage', amount: 0, description: 'x' }],
    }));
    useCartStore.getState().clear();
    expect(useCartStore.getState().dismissedPromotionIds.size).toBe(0);
    expect(useCartStore.getState().appliedPromotions).toEqual([]);
  });
});
