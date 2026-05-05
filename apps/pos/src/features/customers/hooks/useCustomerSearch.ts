// apps/pos/src/features/customers/hooks/useCustomerSearch.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Customer } from '@breakery/domain';

export function useCustomerSearch(query: string) {
  return useQuery<Customer[]>({
    queryKey: ['customers', 'search', query],
    queryFn: async () => {
      if (query.trim().length < 2) return [];
      const { data, error } = await supabase
        .from('customers')
        .select('id, name, phone, email, customer_type, loyalty_points, lifetime_points, total_spent, total_visits, last_visit_at')
        .or(`phone.ilike.%${query}%,name.ilike.%${query}%`)
        .is('deleted_at', null)
        .limit(10);
      if (error) throw error;
      return (data ?? []) as Customer[];
    },
    enabled: query.trim().length >= 2,
    staleTime: 10_000,
  });
}
