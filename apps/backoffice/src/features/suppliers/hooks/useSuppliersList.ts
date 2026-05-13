// apps/backoffice/src/features/suppliers/hooks/useSuppliersList.ts
//
// Filtered BO list of suppliers. Excludes soft-deleted rows. Filterable by
// active/inactive + free-text search across name/code.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { Database } from '@breakery/supabase';

export type SupplierRow = Database['public']['Tables']['suppliers']['Row'];
export type SupplierInsert = Database['public']['Tables']['suppliers']['Insert'];
export type SupplierUpdate = Database['public']['Tables']['suppliers']['Update'];

export type ActiveFilter = 'all' | 'active' | 'inactive';

export interface SuppliersListFilters {
  active?: ActiveFilter;
  search?: string;
}

export const SUPPLIERS_QUERY_KEY = ['suppliers-bo'] as const;

export function useSuppliersList(filters: SuppliersListFilters = {}) {
  return useQuery<SupplierRow[]>({
    queryKey: [...SUPPLIERS_QUERY_KEY, filters] as const,
    queryFn: async () => {
      let q = supabase
        .from('suppliers')
        .select('*')
        .is('deleted_at', null)
        .order('name', { ascending: true });

      if (filters.active === 'active')   q = q.eq('is_active', true);
      if (filters.active === 'inactive') q = q.eq('is_active', false);

      if (filters.search !== undefined && filters.search.trim() !== '') {
        const term = filters.search.trim().replace(/[%_]/g, '\\$&');
        q = q.or(`name.ilike.%${term}%,code.ilike.%${term}%`);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}
