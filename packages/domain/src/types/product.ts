// packages/domain/src/types/product.ts
export type ProductType = 'finished' | 'combo';

export interface Product {
  id: string;
  sku: string;
  name: string;
  category_id: string;
  retail_price: number;
  wholesale_price: number | null;
  product_type: ProductType;
  tax_inclusive: boolean;
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
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  is_active: boolean;
}
