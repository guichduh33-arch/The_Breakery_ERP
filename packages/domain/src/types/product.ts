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
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  is_active: boolean;
}
