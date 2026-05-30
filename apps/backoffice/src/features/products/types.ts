// apps/backoffice/src/features/products/types.ts
//
// Session 14 / Phase 4.B — Local types for the Products feature.
//
// We extend the canonical `Product` from @breakery/domain with denormalised
// data the catalog list needs (category name + cost_price) without polluting
// the IO-free domain types. The shape mirrors the columns selected by
// `useProducts` / `useProductDetail`.

import type { Product } from '@breakery/domain';
import type { AllergenType } from '@breakery/ui';

export type ProductTypeFilter = 'all' | 'finished' | 'semi-finished' | 'raw' | 'combo';

/** Session 27c — Variant-grouping filter for the catalog list. */
export type ProductVariantFilter = 'all' | 'standalone' | 'parents' | 'variants';

export interface ProductRow extends Product {
  cost_price: number;
  unit: string;
  min_stock_threshold: number;
  category_name: string | null;
  /** Self-declared allergens (Session 15 Phase 5.C — `products.allergens`). */
  allergens: ReadonlyArray<AllergenType>;
  // Session 27 — editable fields surfaced by update_product_v1
  description: string | null;
  visible_on_pos: boolean;
  available_for_sale: boolean;
  track_inventory: boolean;
  deduct_stock: boolean;
  is_semi_finished: boolean;
  target_gross_margin_pct: number | null;
  default_shelf_life_hours: number | null;
  // POS display-stock isolation (Wave 6) — when true, the product is sold off
  // a separate "vitrine" counter (display_stock), not the BO global inventory.
  is_display_item: boolean;
  // Session 27c — variant grouping (parent / variant / standalone).
  // `parent_product_id` is null on parents and standalones, set on variants.
  // `variant_label`, `variant_axis`, `variant_sort_order` are null on
  // standalones, populated on variants.
  parent_product_id: string | null;
  variant_label: string | null;
  variant_axis: string | null;
  variant_sort_order: number;
}

export interface CategoryOption {
  id:    string;
  name:  string;
  slug:  string;
  is_active: boolean;
  sort_order: number;
}

export type ProductView = 'grid' | 'list';

export interface ProductsFilterState {
  search:     string;
  categoryId: string | 'all';
  type:       ProductTypeFilter;
  view:       ProductView;
}

export interface ProductsKpis {
  total:          number;
  finished:       number;
  semi_finished:  number;
  raw_material:   number;
  combo:          number;
}

/**
 * Single product page tabs — must mirror the screenshot family
 * (`Product detail1.jpg`, `product general 1/2/3.jpg`, `product unit.jpg`,
 * `product recette.jpg`, ...).
 */
export type ProductDetailTab =
  | 'overview'
  | 'general'
  | 'units'
  | 'recipe'
  | 'variants'
  | 'costing'
  | 'purchase'
  | 'history';

/**
 * The four conceptual product types we surface in the tabs filter, mapped
 * from the wider `product_type` text column. Anything outside the canonical
 * set falls back to 'finished'.
 */
export function classifyProduct(p: Pick<ProductRow, 'product_type' | 'sku'>): ProductTypeFilter {
  if (p.product_type === 'combo') return 'combo';
  // The schema only has `finished` | `combo`. We use SKU prefixes (RAW, SFG)
  // to surface the conceptual breakdown the screenshots show. This is a
  // presentation-only classification — DB writes still go through the
  // `product_type` column.
  const sku = (p.sku ?? '').toUpperCase();
  if (sku.startsWith('RAW') || sku.startsWith('CON') || sku.startsWith('HAS')) return 'raw';
  if (sku.startsWith('SFG')) return 'semi-finished';
  return 'finished';
}
