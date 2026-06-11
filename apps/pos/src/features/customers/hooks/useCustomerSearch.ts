// apps/pos/src/features/customers/hooks/useCustomerSearch.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Customer, CustomerCategory } from '@breakery/domain';

export type CustomerWithCategory = Customer & { category: CustomerCategory | null };

/**
 * S37 C5 (SEC-03) — customer search goes through the SECURITY DEFINER RPC
 * `search_customers_v2` (embed `category` JSONB) instead of a direct
 * `from('customers')` read, so it survives the `customers.read` SELECT gate.
 * The RPC row shape mirrors the old CUSTOMER_SELECT projection exactly.
 */
export function useCustomerSearch(query: string) {
  return useQuery<CustomerWithCategory[]>({
    queryKey: ['customers', 'search', query],
    queryFn: async () => {
      if (query.trim().length < 2) return [];
      const { data, error } = await supabase.rpc('search_customers_v2', {
        p_query: query,
        p_limit: 10,
      });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        ...row,
        category: (row.category ?? null) as CustomerCategory | null,
      })) as unknown as CustomerWithCategory[];
    },
    enabled: query.trim().length >= 2,
    staleTime: 10_000,
  });
}
