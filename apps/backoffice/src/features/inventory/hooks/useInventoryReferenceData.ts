// apps/backoffice/src/features/inventory/hooks/useInventoryReferenceData.ts
//
// Lookup queries used by the inventory page filters + modals (categories +
// active suppliers). Bundled so the page renders both selects without two
// network round-trips and without flashing empty option lists.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface CategoryOption {
  id:   string;
  name: string;
}

export interface SupplierOption {
  id:   string;
  code: string;
  name: string;
}

interface ReferenceData {
  categories: CategoryOption[];
  suppliers:  SupplierOption[];
}

export function useInventoryReferenceData() {
  return useQuery<ReferenceData>({
    queryKey: ['inventory-bo', 'reference-data'] as const,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [categories, suppliers] = await Promise.all([
        supabase
          .from('categories')
          .select('id, name')
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('sort_order'),
        supabase
          .from('suppliers')
          .select('id, code, name')
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('name'),
      ]);

      if (categories.error) throw categories.error;
      if (suppliers.error)  throw suppliers.error;

      return {
        categories: categories.data ?? [],
        suppliers:  suppliers.data  ?? [],
      };
    },
  });
}
