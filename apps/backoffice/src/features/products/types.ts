// apps/backoffice/src/features/products/types.ts
//
// Session 14 / Phase 4.B — Local types for the Products feature.
//
// We extend the canonical `Product` from @breakery/domain with denormalised
// data the catalog list needs (category name + cost_price) without polluting
// the IO-free domain types. The shape mirrors the columns selected by
// `useProducts` / `useProductDetail`.

import type { Product } from '@breakery/domain';

export type ProductTypeFilter = 'all' | 'finished' | 'semi-finished' | 'raw' | 'combo';

export interface ProductRow extends Product {
  cost_price: number;
  unit: string;
  min_stock_threshold: number;
  category_name: string | null;
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
