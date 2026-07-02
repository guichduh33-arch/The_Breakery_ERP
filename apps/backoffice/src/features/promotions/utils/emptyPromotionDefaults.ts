// apps/backoffice/src/features/promotions/utils/emptyPromotionDefaults.ts
//
// Session 13 / Phase 2.C — typed defaults for the new BogoForm /
// ThresholdForm. Keeps the components purely UI-focused.

import type { PromotionFormValues } from '@breakery/ui';

function baseValues(): PromotionFormValues {
  return {
    name: '',
    slug: '',
    description: '',
    type: 'percentage',
    scope: 'cart',
    discount_value: null,
    max_discount_amount: null,
    scope_product_ids: [],
    scope_category_ids: [],
    bogo_trigger_product_ids: [],
    bogo_reward_product_ids: [],
    bogo_trigger_qty: null,
    bogo_reward_qty: null,
    bogo_reward_discount_pct: null,
    bogo_buy_quantity: null,
    bogo_get_quantity: null,
    bogo_get_product_id: null,
    threshold_amount: null,
    threshold_type: null,
    bundle_product_ids: [],
    bundle_price: null,
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
    max_uses: null,
    max_uses_per_customer: null,
    priority: 50,
    stackable_with_promo: false,
    stackable_with_manual: true,
    is_active: true,
  };
}

/** Initial form values for the new BOGO shape. */
export function emptyBogoNewValues(): PromotionFormValues {
  return {
    ...baseValues(),
    type: 'bogo',
    scope: null,
    bogo_buy_quantity: 2,
    bogo_get_quantity: 1,
    bogo_get_product_id: null,
  };
}

/** Initial form values for a threshold promotion (default: subtotal percent). */
export function emptyThresholdValues(): PromotionFormValues {
  return {
    ...baseValues(),
    type: 'threshold',
    scope: null,
    threshold_amount: null,
    threshold_type: 'subtotal',
    discount_value: 10,
    max_discount_amount: 100_000, // signals percent kind
  };
}
