// apps/pos/src/stores/__tests__/cartStore.promotions.test.ts
//
// Bug 1 (Session 36) — loop guard. `setAppliedPromotions` must be idempotent:
// re-applying the same promotions must NOT mint a new `cart` reference, or
// `usePromotionsAutoEval` (whose effect depends on `cart`) re-fires and
// re-calls `evaluate_promotions_v2` every 200ms. It must also never add more
// than one gift line per promotion.

import { describe, it, expect, beforeEach } from 'vitest';
import type { AppliedPromotion, Product } from '@breakery/domain';
import { useCartStore } from '../cartStore';

const SOURDOUGH: Product = {
  id: 'p-loaf',
  name: 'Sourdough Loaf',
  sku: 'SD',
  category_id: 'c-bread',
  retail_price: 75000,
  wholesale_price: null,
  product_type: 'finished',
  image_url: null,
  current_stock: 10,
  is_active: true,
  is_favorite: false,
};

// "Buy 2 Get 1 Free" modelled as a gift promo — amount is 0 (the gift line is
// the discount), gift_to_add seeds the free Sourdough.
const GIFT_PROMO: AppliedPromotion[] = [
  {
    promotion_id: 'promo-bogo',
    slug: 'buy-2-get-1-sourdough',
    name: 'Buy 2 Get 1 Free — Sourdough Loaf',
    type: 'free_product',
    amount: 0,
    description: 'Buy 2 Get 1 Free',
    gift_to_add: { product_id: 'p-loaf', qty: 1 },
  },
];

const LOOKUP = { 'p-loaf': { name: 'Sourdough Loaf' } };

beforeEach(() => {
  useCartStore.setState({
    cart: { items: [], order_type: 'dine_in' },
    appliedPromotions: [],
    dismissedPromotionIds: new Set<string>(),
    lockedItemIds: [],
    printedItemIds: [],
    attachedCustomer: null,
    pickedUpOrderId: null,
  });
});

describe('cartStore.setAppliedPromotions — idempotent reconcile (Bug 1 loop guard)', () => {
  it('adds exactly one gift line, then preserves the cart reference on a no-op re-eval', () => {
    useCartStore.getState().add(SOURDOUGH); // one paid loaf

    const first = useCartStore.getState().setAppliedPromotions(GIFT_PROMO, LOOKUP);
    expect(first.addedGifts).toHaveLength(1);

    const cartAfterAdd = useCartStore.getState().cart;
    const giftLines = cartAfterAdd.items.filter((i) => i.is_promo_gift);
    expect(giftLines).toHaveLength(1);
    expect(giftLines[0]!.unit_price).toBe(0);

    // Re-evaluate with the identical applied promotions — nothing changes.
    const second = useCartStore.getState().setAppliedPromotions(GIFT_PROMO, LOOKUP);
    expect(second.addedGifts).toHaveLength(0);
    expect(second.removedGifts).toHaveLength(0);

    // Same `cart` reference → the auto-eval effect won't re-fire (no RPC loop).
    expect(useCartStore.getState().cart).toBe(cartAfterAdd);
    // And still exactly one gift line — never duplicated.
    expect(useCartStore.getState().cart.items.filter((i) => i.is_promo_gift)).toHaveLength(1);
  });

  it('mints a new cart reference only when a gift is actually added or removed', () => {
    useCartStore.getState().add(SOURDOUGH);
    const before = useCartStore.getState().cart;

    // Adding the gift changes the cart (new reference expected).
    useCartStore.getState().setAppliedPromotions(GIFT_PROMO, LOOKUP);
    const afterAdd = useCartStore.getState().cart;
    expect(afterAdd).not.toBe(before);

    // Removing the promo drops the gift line → new reference again.
    const removed = useCartStore.getState().setAppliedPromotions([], LOOKUP);
    expect(removed.removedGifts).toHaveLength(1);
    expect(useCartStore.getState().cart).not.toBe(afterAdd);
    expect(useCartStore.getState().cart.items.filter((i) => i.is_promo_gift)).toHaveLength(0);
  });
});
