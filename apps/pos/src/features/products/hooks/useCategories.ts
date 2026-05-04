// apps/pos/src/features/products/hooks/useCategories.ts
import { useQuery } from '@tanstack/react-query';
import type { Category } from '@breakery/domain';
import { supabase } from '@/lib/supabase';

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name, slug, sort_order, is_active')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
  });
}
