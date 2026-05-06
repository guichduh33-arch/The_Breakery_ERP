// apps/pos/src/features/customers/hooks/useCustomerSearch.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Customer, CustomerCategory } from '@breakery/domain';

export type CustomerWithCategory = Customer & { category: CustomerCategory | null };

export function useCustomerSearch(query: string) {
  return useQuery<CustomerWithCategory[]>({
    queryKey: ['customers', 'search', query],
    queryFn: async () => {
      if (query.trim().length < 2) return [];
      const { data, error } = await supabase
        .from('customers')
        .select('id, name, phone, email, customer_type, loyalty_points, lifetime_points, total_spent, total_visits, last_visit_at, category_id, category:customer_categories(id, name, slug, color, icon, price_modifier_type, discount_percentage, loyalty_enabled, points_multiplier, is_default)')
        .or(`phone.ilike.%${query}%,name.ilike.%${query}%`)
        .is('deleted_at', null)
        .limit(10);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        ...row,
        category: row.category ?? null,
      })) as unknown as CustomerWithCategory[];
    },
    enabled: query.trim().length >= 2,
    staleTime: 10_000,
  });
}
