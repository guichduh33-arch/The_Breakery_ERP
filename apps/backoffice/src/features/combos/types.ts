// apps/backoffice/src/features/combos/types.ts
//
// Session 47 — rewrites the old combo_items-based types to the new
// choice-group schema (combo_groups + combo_group_options).
//
// The `Combo` card type carries groups (by name) + priceRange + valuePrice
// derived via domain helpers so the grid and cards render efficiently.

export interface ComboOptionSummary {
  component_product_id: string;
  label: string;
  surcharge: number;
  is_default: boolean;
}

export interface ComboGroupSummary {
  id: string;
  name: string;
  group_type: 'single' | 'multi';
  is_required: boolean;
  min_select: number;
  max_select: number;
  options: ComboOptionSummary[];
}

export interface Combo {
  id: string;
  name: string;
  sku: string;
  /** Bundle Set Price (combo_base_price on the products row). */
  retail_price: number;
  /** Value price = Σ default-component retail prices (struck-through). */
  value_price: number | null;
  /** Min/max bundle price including surcharges across all choices. */
  price_min: number;
  price_max: number;
  is_active: boolean;
  image_url: string | null;
  groups: ComboGroupSummary[];
}

export interface CombosKpis {
  total: number;
  active: number;
  inactive: number;
}

export function emptyKpis(): CombosKpis {
  return { total: 0, active: 0, inactive: 0 };
}
