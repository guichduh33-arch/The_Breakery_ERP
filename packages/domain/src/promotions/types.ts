// packages/domain/src/promotions/types.ts
//
// Promotion domain types — session 9.
// Spec ref: docs/superpowers/specs/2026-05-10-session-9-promotions-spec.md §1 P1–P13, §4.1

export type PromotionType  = 'percentage' | 'fixed_amount' | 'bogo' | 'free_product';
export type PromotionScope = 'cart' | 'product' | 'category';

/**
 * Promotion row fetched from `promotions` table. Mirrors columns 1:1.
 * Stored as plain JSON; re-evaluated client-side at every cart change and
 * server-side at checkout (see RPC v7).
 */
export interface Promotion {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  type: PromotionType;
  scope: PromotionScope | null;

  // Percentage / Fixed amount config
  discount_value: number | null;
  max_discount_amount: number | null;
  scope_product_ids: string[];
  scope_category_ids: string[];

  // BOGO config
  bogo_trigger_product_ids: string[];
  bogo_reward_product_ids: string[];
  bogo_trigger_qty: number | null;
  bogo_reward_qty: number | null;
  bogo_reward_discount_pct: number | null;

  // Free product config
  gift_product_id: string | null;
  gift_qty: number;

  // Conditions
  min_items_total: number;
  customer_category_ids: string[];
  customer_tier_ids: string[];
  start_at: string | null;
  end_at: string | null;
  /** Bitmask 0..127, bits 0..6 = Mon..Sun (ISO day-of-week 1..7 minus 1). */
  day_of_week_mask: number;
  start_hour: number | null;
  end_hour: number | null;

  // Stacking
  priority: number;
  stackable_with_promo: boolean;
  stackable_with_manual: boolean;

  // Lifecycle
  is_active: boolean;
  created_at: string;
}

/**
 * Free-gift descriptor returned by the evaluator for `free_product` promos.
 * The cart store will mirror this into a CartItem with `is_promo_gift=true`.
 */
export interface AppliedFreeProduct {
  product_id: string;
  qty: number;
}

/**
 * One promotion that the evaluator decided to apply to the current cart.
 * `amount` is always a positive IDR value (subtracted from the cart total
 * downstream). For `free_product`, `amount` is 0 — the discount is the gift
 * line itself (unit_price=0). `gift_to_add` carries the product+qty payload
 * the cart store should auto-add.
 */
export interface AppliedPromotion {
  promotion_id: string;
  slug: string;
  name: string;
  type: PromotionType;
  /** IDR ≥ 0 — to subtract from the cart total. */
  amount: number;
  /** Snapshot human-readable label persisted in promotion_applications. */
  description: string;
  /** When the promo targets a single line (line-scoped percentage), reference its id. */
  scope_line_id?: string;
  /** Free-gift payload for cart auto-add (only for type=free_product). */
  gift_to_add?: AppliedFreeProduct;
}

/**
 * Catalog snapshot consumed by the evaluator. Provides product/category
 * lookups without coupling the domain layer to the data layer. The evaluator
 * only reads `category_id` and `retail_price` (best-effort fallback when a
 * cart item's `unit_price` is overridden via category pricing).
 */
export interface PromotionCatalog {
  /** product_id → category_id (for category-scoped promos). */
  productCategory: Record<string, string>;
  /** product_id → retail price (for BOGO unit savings calculation). */
  productPrice: Record<string, number>;
}

/**
 * Lightweight customer profile expected by the evaluator. Matches what the
 * POS attaches to the cart — `category_id` + `tier_id` are optional because
 * a cart can be checked out anonymously.
 */
export interface PromotionCustomer {
  id: string;
  /** customer_category_id (FK → customer_categories). */
  category_id?: string | null;
  /** customer_tier_id (FK → customer_tiers / loyalty tier mapping). */
  tier_id?: string | null;
}
