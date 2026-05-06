// packages/domain/src/customerCategories/types.ts
//
// Customer category domain types — session 7.
// Spec ref: docs/superpowers/specs/2026-05-06-session-7-customer-categories-combos-spec.md §1 CC1–CC2

export type PriceModifierType = 'retail' | 'wholesale' | 'discount_percentage' | 'custom';

export interface CustomerCategory {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  icon: string | null;
  price_modifier_type: PriceModifierType;
  discount_percentage: number;
  loyalty_enabled: boolean;
  points_multiplier: number;
  is_default: boolean;
}
