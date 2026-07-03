// apps/backoffice/src/features/promotions/hooks/promotionRowMappers.ts
//
// Helper that maps the form-friendly `PromotionFormValues` into the snake-cased
// row shape that the `promotions` Postgres table expects. Centralised so that
// both create and update mutations stay in sync.
//
// Spec ref: docs/superpowers/specs/2026-05-10-session-9-promotions-spec.md §3.1

import type { PromotionFormValues } from '@breakery/ui';
import type { Database } from '@breakery/supabase';

export type PromotionInsert = Database['public']['Tables']['promotions']['Insert'];
export type PromotionUpdate = Database['public']['Tables']['promotions']['Update'];

// `toRow` accepts a partial form payload and returns the loose Update shape
// (every column optional). For INSERT, callers must pass a fully-populated
// `PromotionFormValues` and cast to `PromotionInsert` — the form's create
// mode guarantees `name`, `slug`, and `type` are set.
type PromotionRow = PromotionUpdate;

/** Convert empty datetime-local strings to null (form keeps `null` already, but
 *  defensive in case a partial Update passes through with an empty string).
 */
function emptyToNull(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  return s === '' ? null : s;
}

export function toRow(values: Partial<PromotionFormValues>): PromotionRow {
  const row: PromotionRow = {};
  if (values.name !== undefined) row.name = values.name.trim();
  if (values.slug !== undefined) row.slug = values.slug.trim();
  if (values.description !== undefined) {
    row.description = values.description === '' ? null : values.description;
  }
  if (values.type !== undefined) row.type = values.type;
  if (values.scope !== undefined) row.scope = values.scope;

  if (values.discount_value !== undefined) row.discount_value = values.discount_value;
  if (values.max_discount_amount !== undefined) row.max_discount_amount = values.max_discount_amount;
  if (values.scope_product_ids !== undefined) row.scope_product_ids = values.scope_product_ids;
  if (values.scope_category_ids !== undefined) row.scope_category_ids = values.scope_category_ids;

  if (values.bogo_trigger_product_ids !== undefined) {
    row.bogo_trigger_product_ids = values.bogo_trigger_product_ids;
  }
  if (values.bogo_reward_product_ids !== undefined) {
    row.bogo_reward_product_ids = values.bogo_reward_product_ids;
  }
  if (values.bogo_trigger_qty !== undefined) row.bogo_trigger_qty = values.bogo_trigger_qty;
  if (values.bogo_reward_qty !== undefined) row.bogo_reward_qty = values.bogo_reward_qty;
  if (values.bogo_reward_discount_pct !== undefined) {
    row.bogo_reward_discount_pct = values.bogo_reward_discount_pct;
  }

  // Session 13 / Phase 2.C — new shapes
  if (values.bogo_buy_quantity !== undefined) {
    row.bogo_buy_quantity = values.bogo_buy_quantity;
  }
  if (values.bogo_get_quantity !== undefined) {
    row.bogo_get_quantity = values.bogo_get_quantity;
  }
  if (values.bogo_get_product_id !== undefined) {
    row.bogo_get_product_id = values.bogo_get_product_id;
  }
  if (values.threshold_amount !== undefined) {
    row.threshold_amount = values.threshold_amount;
  }
  if (values.threshold_type !== undefined) {
    row.threshold_type = values.threshold_type;
  }
  if (values.bundle_product_ids !== undefined) {
    row.bundle_product_ids = values.bundle_product_ids.length === 0 ? null : values.bundle_product_ids;
  }
  if (values.bundle_price !== undefined) {
    row.bundle_price = values.bundle_price;
  }

  if (values.gift_product_id !== undefined) row.gift_product_id = values.gift_product_id;
  if (values.gift_qty !== undefined) row.gift_qty = values.gift_qty;

  if (values.min_items_total !== undefined) row.min_items_total = values.min_items_total;
  if (values.customer_category_ids !== undefined) {
    row.customer_category_ids = values.customer_category_ids;
  }
  if (values.customer_tier_ids !== undefined) row.customer_tier_ids = values.customer_tier_ids;
  if (values.start_at !== undefined) row.start_at = emptyToNull(values.start_at);
  if (values.end_at !== undefined) row.end_at = emptyToNull(values.end_at);
  if (values.day_of_week_mask !== undefined) row.day_of_week_mask = values.day_of_week_mask;
  if (values.start_hour !== undefined) row.start_hour = values.start_hour;
  if (values.end_hour !== undefined) row.end_hour = values.end_hour;

  // Usage caps (Session 57 / A-D4) — NULL = unlimited.
  if (values.max_uses !== undefined) row.max_uses = values.max_uses;
  if (values.max_uses_per_customer !== undefined) {
    row.max_uses_per_customer = values.max_uses_per_customer;
  }

  if (values.priority !== undefined) row.priority = values.priority;
  if (values.stackable_with_promo !== undefined) {
    row.stackable_with_promo = values.stackable_with_promo;
  }
  if (values.stackable_with_manual !== undefined) {
    row.stackable_with_manual = values.stackable_with_manual;
  }
  if (values.is_active !== undefined) row.is_active = values.is_active;

  return row;
}
