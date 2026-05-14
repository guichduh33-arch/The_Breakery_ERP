// apps/backoffice/src/features/combos/types.ts
//
// Session 14 / Phase 4.B — Local types for the Combos feature.
//
// Mirrors the data shape of `combo_items`:
//   - parent_product_id (a product whose product_type='combo')
//   - component_product_id (any product included in the bundle)
//   - quantity
//   - sort_order
//
// We surface a denormalised `Combo` entity that bundles the parent product +
// a grouped list of components by category so the cards in `combo
// management.jpg` render efficiently.

import type { ProductRow } from '../products/types.js';

export interface ComboComponent {
  product_id:    string;
  product_name:  string;
  category_name: string | null;
  quantity:      number;
  sort_order:    number;
  /** Markup vs base — surfaced as "+Rp X" pills in the screenshot. */
  upcharge:      number;
}

export interface ComboCategoryGroup {
  category_name: string;
  components:    ReadonlyArray<ComboComponent>;
}

export interface Combo {
  id:           string;
  name:         string;
  sku:          string;
  retail_price: number;
  /** Sum of `cost_price * quantity` across components. */
  base_price:   number;
  is_active:    boolean;
  image_url:    string | null;
  groups:       ReadonlyArray<ComboCategoryGroup>;
}

export interface CombosKpis {
  total:     number;
  active:    number;
  inactive:  number;
}

export function emptyKpis(): CombosKpis {
  return { total: 0, active: 0, inactive: 0 };
}

/**
 * Derive the discount % a combo offers vs its base price (cost-of-components
 * sum). Returns `null` when the base price is 0 (no components).
 */
export function comboSavingsPct(combo: Pick<Combo, 'retail_price' | 'base_price'>): number | null {
  if (combo.base_price <= 0) return null;
  if (combo.retail_price >= combo.base_price) return 0;
  return Math.round(((combo.base_price - combo.retail_price) / combo.base_price) * 100);
}

export type ComboParent = Pick<ProductRow, 'id' | 'name' | 'sku' | 'retail_price' | 'is_active' | 'image_url'>;
