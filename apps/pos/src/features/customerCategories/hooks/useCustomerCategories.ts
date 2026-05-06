// apps/pos/src/features/customerCategories/hooks/useCustomerCategories.ts
import { useQuery } from '@tanstack/react-query';
import type { CustomerCategory } from '@breakery/domain';
import { supabase } from '@/lib/supabase';

export function useCustomerCategories() {
  return useQuery<CustomerCategory[]>({
    queryKey: ['customer_categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customer_categories')
        .select('id, name, slug, color, icon, price_modifier_type, discount_percentage, loyalty_enabled, points_multiplier, is_default')
        .is('deleted_at', null)
        .eq('is_active', true);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}
