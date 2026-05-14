// apps/backoffice/src/features/customers/hooks/useCustomerCategories.ts
//
// Session 14 / Phase 5.B — fetches active customer categories. Used by the
// Customers list filter dropdown and the Categories management page.

import { useQuery } from '@tanstack/react-query';
import type { CustomerCategory } from '@breakery/domain';
import { supabase } from '@/lib/supabase.js';

export const CUSTOMER_CATEGORIES_QUERY_KEY = ['customer-categories-bo'] as const;

const SELECT_COLS = [
  'id', 'name', 'slug', 'color', 'icon',
  'price_modifier_type', 'discount_percentage',
  'loyalty_enabled', 'points_multiplier',
  'is_default',
].join(', ');

export interface CustomerCategoryRow extends CustomerCategory {
  is_active:        boolean;
  customer_count?:  number;
}

export function useCustomerCategories() {
  return useQuery<CustomerCategoryRow[]>({
    queryKey: CUSTOMER_CATEGORIES_QUERY_KEY,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customer_categories')
        .select(`${SELECT_COLS}, is_active`)
        .is('deleted_at', null)
        .order('is_default', { ascending: false })
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as CustomerCategoryRow[];
    },
  });
}
