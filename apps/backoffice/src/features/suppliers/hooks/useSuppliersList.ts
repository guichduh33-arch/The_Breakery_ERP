// apps/backoffice/src/features/suppliers/hooks/useSuppliersList.ts
//
// Filtered BO list of suppliers. Excludes soft-deleted rows. Filterable by
// active/inactive + free-text search across name/code.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { ilikeAnyFilter } from '@/lib/postgrestSearch.js';
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

/** Filtre `.or()` de la recherche fournisseurs (S1-13), `null` si rien à chercher. */
export function supplierSearchFilter(raw: string): string | null {
  return ilikeAnyFilter(['name', 'code'], raw);
}

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

      const search = supplierSearchFilter(filters.search ?? '');
      if (search !== null) q = q.or(search);

      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}
