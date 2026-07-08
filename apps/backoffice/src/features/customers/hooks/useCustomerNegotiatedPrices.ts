// apps/backoffice/src/features/customers/hooks/useCustomerNegotiatedPrices.ts
//
// Per-customer negotiated product price overrides — powers the
// "Negotiated prices" section of the customer detail Pricing tab. Unlike
// category overrides (product_category_prices, applied to every customer in
// a category), these rows are scoped to a single customer_id and take
// priority server-side: create_b2b_order_v5 resolves negotiated (customer) >
// category > retail.
//
// S69 Volet B (Task 8) — the read query is PostgREST-direct (customer_id is
// RLS-scoped read access), writes go through the Task 6 RPCs:
// upsert_customer_product_price_v1 / delete_customer_product_price_v1 (both
// gated server-side on customer_prices.manage).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface NegotiatedPrice {
  product_id: string;
  product_name: string;
  product_sku: string | null;
  retail_price: number;
  negotiated_price: number;
}

export const customerNegotiatedPricesKey = (customerId: string | null | undefined) =>
  ['customer-negotiated-prices', customerId] as const;

export function useCustomerNegotiatedPrices(customerId: string | null | undefined) {
  return useQuery<NegotiatedPrice[]>({
    queryKey: customerNegotiatedPricesKey(customerId),
    enabled: !!customerId,
    staleTime: 60_000,
    queryFn: async () => {
      if (!customerId) return [];
      const { data, error } = await supabase
        .from('customer_product_prices')
        .select('product_id, price, product:products(name, sku, retail_price)')
        .eq('customer_id', customerId);
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
          negotiated_price: Number(row.price),
        };
      });
    },
  });
}

export function useUpsertNegotiatedPrice(customerId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { productId: string; price: number }) => {
      const { error } = await supabase.rpc('upsert_customer_product_price_v1', {
        // customerId is only ever invoked from a UI branch where the customer
        // (and thus its id) is known — the RPC arg is non-nullable.
        p_customer_id: customerId!,
        p_product_id: v.productId,
        p_price: v.price,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: customerNegotiatedPricesKey(customerId) }),
  });
}

export function useDeleteNegotiatedPrice(customerId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (productId: string) => {
      const { error } = await supabase.rpc('delete_customer_product_price_v1', {
        p_customer_id: customerId!,
        p_product_id: productId,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: customerNegotiatedPricesKey(customerId) }),
  });
}
