// apps/backoffice/src/features/customers/hooks/useCustomerCategoryPrices.ts
//
// Custom per-category product price overrides — powers the Pricing tab of the
// customer detail page. Pricing on this project is resolved per customer
// CATEGORY (see get_customer_product_price): a customer inherits their
// category's modifier (retail / wholesale / discount_percentage / custom) and,
// when the modifier is `custom`, a set of explicit product overrides stored in
// `product_category_prices`. Read-only — no new RPC.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface CategoryPriceOverride {
  product_id: string;
  product_name: string;
  product_sku: string | null;
  retail_price: number;
  custom_price: number;
}

export const customerCategoryPricesKey = (categoryId: string | null | undefined) =>
  ['customer-category-prices', categoryId] as const;

export function useCustomerCategoryPrices(categoryId: string | null | undefined) {
  return useQuery<CategoryPriceOverride[]>({
    queryKey: customerCategoryPricesKey(categoryId),
    enabled: !!categoryId,
    staleTime: 60_000,
    queryFn: async () => {
      if (!categoryId) return [];
      const { data, error } = await supabase
        .from('product_category_prices')
        .select('product_id, price, product:products(name, sku, retail_price)')
        .eq('customer_category_id', categoryId);
      if (error) throw error;

      return (data ?? []).map((row) => {
        const raw = (row as Record<string, unknown>).product;
        const product = (Array.isArray(raw) ? raw[0] : raw) as
          | { name: string; sku: string | null; retail_price: number }
          | null;
        return {
          product_id: row.product_id,
          product_name: product?.name ?? '—',
          product_sku: product?.sku ?? null,
          retail_price: Number(product?.retail_price ?? 0),
          custom_price: Number(row.price),
        };
      });
    },
  });
}
