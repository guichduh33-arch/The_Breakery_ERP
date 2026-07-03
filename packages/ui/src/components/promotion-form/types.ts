// packages/ui/src/components/promotion-form/types.ts
//
// Shared types, constants and defaults for the split PromotionForm. The public
// surface (PromotionFormValues, PromotionFormOption, emptyPromotionValues, …)
// is re-exported from ../PromotionForm.tsx so `@breakery/ui` consumers see no
// change.
//
// Spec refs:
//   docs/superpowers/specs/2026-05-10-session-9-promotions-spec.md §3.1
//   docs/superpowers/specs/2026-07-03-s57-p2-governance-ux-design.md A-D4 / A-D9 / E-D4

import type { PromotionScope, PromotionType } from '@breakery/domain';

export type { PromotionScope };

// ---------------------------------------------------------------------------
// Values (matches `Promotion` in @breakery/domain minus read-only metadata)
// ---------------------------------------------------------------------------

export interface PromotionFormValues {
  id?: string;
  name: string;
  slug: string;
  description: string | null;
  type: PromotionType;
  scope: PromotionScope | null;

  // Percentage / Fixed amount
  discount_value: number | null;
  max_discount_amount: number | null;
  scope_product_ids: string[];
  scope_category_ids: string[];

  // BOGO (legacy multi-product shape — Session 9)
  bogo_trigger_product_ids: string[];
  bogo_reward_product_ids: string[];
  bogo_trigger_qty: number | null;
  bogo_reward_qty: number | null;
  bogo_reward_discount_pct: number | null;

  // BOGO (new single-product shape — Session 13 / Phase 2.C)
  bogo_buy_quantity: number | null;
  bogo_get_quantity: number | null;
  bogo_get_product_id: string | null;

  // Threshold (Session 13 / Phase 2.C)
  threshold_amount: number | null;
  threshold_type: 'subtotal' | 'quantity' | null;

  // Bundle (Session 13 / Phase 2.C)
  bundle_product_ids: string[];
  bundle_price: number | null;

  // Free product
  gift_product_id: string | null;
  gift_qty: number;

  // Conditions
  min_items_total: number;
  customer_category_ids: string[];
  customer_tier_ids: string[];
  start_at: string | null;
  end_at: string | null;
  day_of_week_mask: number;
  start_hour: number | null;
  end_hour: number | null;

  // Usage caps (Session 57 / A-D4 / A-D9) — NULL = unlimited, CHECK > 0
  max_uses: number | null;
  max_uses_per_customer: number | null;

  // Stacking
  priority: number;
  stackable_with_promo: boolean;
  stackable_with_manual: boolean;

  is_active: boolean;
}

export interface PromotionFormOption {
  id: string;
  label: string;
}

export interface PromotionFormProps {
  mode: 'create' | 'edit';
  initialValues?: PromotionFormValues;
  productOptions: PromotionFormOption[];
  categoryOptions: PromotionFormOption[];
  customerCategoryOptions: PromotionFormOption[];
  customerTierOptions: PromotionFormOption[];
  onSubmit: (values: PromotionFormValues) => Promise<void> | void;
  onCancel: () => void;
}

export type PromotionFormErrors = Partial<Record<keyof PromotionFormValues | '_form', string>>;

/** Setter shared with each tab: `update('name', 'x')`. */
export type PromotionFormUpdate = <K extends keyof PromotionFormValues>(
  key: K,
  next: PromotionFormValues[K],
) => void;

/** Returns the submit-gated error for a field (undefined until submitted). */
export type PromotionFieldErrorFn = (key: keyof PromotionFormValues) => string | undefined;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PROMOTION_TYPES: readonly PromotionType[] = [
  'percentage',
  'fixed_amount',
  'bogo',
  'free_product',
] as const;
export const SCOPES: readonly PromotionScope[] = ['cart', 'product', 'category'] as const;
export const DAY_LABELS: readonly string[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function emptyPromotionValues(): PromotionFormValues {
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
    bogo_trigger_qty: 1,
    bogo_reward_qty: 1,
    bogo_reward_discount_pct: 100,
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
    priority: 0,
    stackable_with_promo: false,
    stackable_with_manual: true,
    is_active: true,
  };
}
