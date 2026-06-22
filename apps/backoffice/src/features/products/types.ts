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
  /**
   * Authoritative conceptual type, from `categories.category_type`
   * ('raw_material' | 'semi_finished' | 'finished'). Drives `classifyProduct`;
   * the old SKU-prefix heuristic was unreliable (only RAW/CON/HAS/SFG matched).
   */
  category_type: string | null;
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
  | 'analytics'
  | 'general'
  | 'units'
  | 'recipe'
  | 'variants'
  | 'modifiers'
  | 'costing'
  | 'purchase'
  | 'stations'
  | 'history';

/**
 * The four conceptual product types surfaced in the tabs filter, KPI grid and
 * the catalog "Type" column.
 *
 * The authoritative source is the product's `categories.category_type`
 * ('raw_material' | 'semi_finished' | 'finished') — NOT the `product_type`
 * column (schema only allows 'finished' | 'combo') nor the SKU prefix. The old
 * SKU-prefix heuristic only recognised RAW/CON/HAS/SFG, so raw materials with
 * any other prefix (SEE, PAC, VEG, DAI, DRY, FRU…) were mislabelled 'Finished'.
 *
 * `combo` still comes from `product_type`. When `category_type` is absent we
 * fall back to the per-product `is_semi_finished` flag, then the legacy SKU
 * heuristic, then 'finished'.
 */
export function classifyProduct(
  p: Pick<ProductRow, 'product_type' | 'sku' | 'category_type' | 'is_semi_finished'>,
): ProductTypeFilter {
  if (p.product_type === 'combo') return 'combo';

  switch (p.category_type) {
    case 'raw_material':  return 'raw';
    case 'semi_finished': return 'semi-finished';
    case 'finished':      return 'finished';
    default:              break; // category_type missing → fall through
  }

  if (p.is_semi_finished) return 'semi-finished';
  const sku = (p.sku ?? '').toUpperCase();
  if (sku.startsWith('RAW') || sku.startsWith('CON') || sku.startsWith('HAS')) return 'raw';
  if (sku.startsWith('SFG')) return 'semi-finished';
  return 'finished';
}
