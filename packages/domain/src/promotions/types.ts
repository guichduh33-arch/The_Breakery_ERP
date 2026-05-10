// packages/domain/src/promotions/types.ts
// Spec §4.1 — types principaux.

export type PromotionActionType = 'percentage_off' | 'fixed_off' | 'bogo' | 'free_product';

export type PromotionTarget = 'cart' | 'category' | 'product';

export interface Promotion {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  action_type: PromotionActionType;
  action_params: Record<string, unknown>;
  conditions: { all: PromotionCondition[] };
  priority: number;
  is_active: boolean;
}

export type PromotionCondition =
  | { type: 'cart_total_min'; value: number }
  | { type: 'product_in_cart'; product_id: string; min_qty: number }
  | { type: 'category_in_cart'; category_id: string; min_qty: number }
  | { type: 'customer_category_in'; category_ids: string[] }
  | { type: 'time_window'; start: string; end: string; tz: string }
  | { type: 'weekday_in'; days: number[] }
  | { type: 'valid_dates'; from: string; until: string }
  | {
      type: 'customer_in_loyalty_tier';
      tiers: ('Bronze' | 'Silver' | 'Gold' | 'Platinum')[];
    }
  | { type: 'first_order_only' };

export interface ItemToAdd {
  product_id: string;
  qty: number;
  unit_price: number;
  promotion_discount: number;
  is_free_from_promo: boolean;
  split_from_existing?: boolean;
}

export interface AppliedPromotion {
  promotion_id: string;
  name: string;
  action_type: PromotionActionType;
  target: 'cart' | 'item';
  target_product_id: string | null;
  discount_amount: number;
  items_to_add: ItemToAdd[];
}

export interface SkippedPromotion {
  promotion_id: string;
  reason: string;
}

export interface EvaluationResult {
  applied_promotion: AppliedPromotion | null;
  skipped_promotions: SkippedPromotion[];
}

export interface EvaluationContext {
  items: {
    product_id: string;
    category_id: string;
    qty: number;
    unit_price: number;
    modifier_total: number;
    manual_discount_amount: number;
  }[];
  customer_category_id: string | null;
  customer_tier: 'Bronze' | 'Silver' | 'Gold' | 'Platinum';
  customer_first_order: boolean;
  evaluation_ts: Date;
}
