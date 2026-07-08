// apps/backoffice/src/features/customers/hooks/useCustomerCategoryPrices.ts
//
// Custom per-category product price overrides — powers the Pricing tab of the
// customer detail page. Pricing on this project is resolved per customer
// CATEGORY (see get_customer_product_price): a customer inherits their
// category's modifier (retail / wholesale / discount_percentage / custom) and,
// when the modifier is `custom`, a set of explicit product overrides stored in
// `product_category_prices`.
//
// S69 Volet A (Task 4) — the read query stays PostgREST-direct (no RPC), but
// writes now go through the Task 2 RPCs: upsert_product_category_price_v1 /
// delete_product_category_price_v1 (both gated server-side on
// customer_categories.update).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

export function useUpsertCategoryPrice(categoryId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { productId: string; price: number }) => {
      const { error } = await supabase.rpc('upsert_product_category_price_v1', {
        // categoryId is only ever invoked from a UI branch where the category
        // (and thus its id) is known — the RPC arg is non-nullable.
        p_category_id: categoryId!,
        p_product_id: v.productId,
        p_price: v.price,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: customerCategoryPricesKey(categoryId) }),
  });
}

export function useDeleteCategoryPrice(categoryId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (productId: string) => {
      const { error } = await supabase.rpc('delete_product_category_price_v1', {
        p_category_id: categoryId!,
        p_product_id: productId,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: customerCategoryPricesKey(categoryId) }),
  });
}
