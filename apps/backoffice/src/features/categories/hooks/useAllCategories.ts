// apps/backoffice/src/features/categories/hooks/useAllCategories.ts
// Session 27b — Fetches all (active + inactive) categories for the management page.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface CategoryRow {
  id:               string;
  name:             string;
  slug:             string;
  sort_order:       number;
  is_active:        boolean;
  dispatch_station: string;
  kds_station:      string;
}

export const CATEGORIES_ALL_KEY = ['categories', 'all'] as const;

export function useAllCategories() {
  return useQuery<CategoryRow[]>({
    queryKey: CATEGORIES_ALL_KEY,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name, slug, sort_order, is_active, dispatch_station, kds_station')
        .is('deleted_at', null)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as CategoryRow[];
    },
  });
}
