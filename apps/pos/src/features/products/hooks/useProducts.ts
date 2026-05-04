// apps/pos/src/features/products/hooks/useProducts.ts
import { useQuery } from '@tanstack/react-query';
import type { Product } from '@breakery/domain';
import { supabase } from '@/lib/supabase';

export function useProducts() {
  return useQuery({
    queryKey: ['products'],
    queryFn: async (): Promise<Product[]> => {
      const { data, error } = await supabase
        .from('products')
        .select('id, sku, name, category_id, retail_price, tax_inclusive, image_url, current_stock, is_active, is_favorite')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });
}
