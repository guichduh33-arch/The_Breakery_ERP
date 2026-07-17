// packages/domain/src/types/product.ts
import type { DispatchStation } from '../kitchen/types.js';

export type ProductType = 'finished' | 'combo';

export interface Product {
  id: string;
  sku: string;
  name: string;
  category_id: string;
  retail_price: number;
  wholesale_price: number | null;
  product_type: ProductType;
  // Lot 6b — `tax_inclusive` retiré : le flag par produit est déprécié, le
  // mode fiscal est global (`business_config.tax_inclusive`, useTaxConfig).
  image_url: string | null;
  current_stock: number;
  is_active: boolean;
  is_favorite: boolean;
  // Session 27c — variant grouping (POS-derived, optional on read).
  // `parent_product_id` is sourced from the DB column ; `has_variants` is
  // derived client-side in the POS `useProducts` hook (true when this product
  // has at least one active child variant).
  parent_product_id?: string | null;
  has_variants?: boolean;
  // Session 34 — station ticket printing. Flattened from categories.dispatch_station
  // by the POS `useProducts` hook; defaults to 'none' when the category has no routing.
  dispatch_station?: DispatchStation;
  // S43 (P1-1) — sellability POS. `track_inventory=false` (boissons à la minute)
  // n'est jamais sold out ; sinon le compteur vitrine display_stock prime,
  // fallback current_stock quand aucune ligne vitrine n'existe.
  track_inventory?: boolean;
  is_sellable?: boolean;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  is_active: boolean;
}
