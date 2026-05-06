// apps/pos/src/features/combos/hooks/useComboItems.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface ComboItemWithProduct {
  component_product_id: string;
  quantity: number;
  sort_order: number;
  product: { id: string; name: string };
}

export function useComboItems(parentProductId: string) {
  return useQuery<ComboItemWithProduct[]>({
    queryKey: ['combo_items', parentProductId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('combo_items')
        .select('component_product_id, quantity, sort_order, product:products!component_product_id(id, name)')
        .eq('parent_product_id', parentProductId)
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
    enabled: Boolean(parentProductId),
  });
}
