// apps/backoffice/src/features/products/hooks/useProducts.ts
import { useQuery } from '@tanstack/react-query';
import type { Product } from '@breakery/domain';
import { supabase } from '@/lib/supabase.js';

export function useProducts() {
  return useQuery<Product[]>({
    queryKey: ['products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, sku, name, category_id, retail_price, wholesale_price, product_type, tax_inclusive, image_url, current_stock, is_active, is_favorite')
        .is('deleted_at', null)
        .order('name');
      if (error) throw error;
      return (data ?? []) as Product[];
    },
  });
}
