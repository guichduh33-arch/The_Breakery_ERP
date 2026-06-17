// apps/backoffice/src/features/categories/hooks/useAllCategories.ts
// Session 27b — Fetches all (active + inactive) categories for the management page.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export type CategoryType = 'raw_material' | 'semi_finished' | 'finished';

export interface CategoryRow {
  id:               string;
  name:             string;
  slug:             string;
  sort_order:       number;
  is_active:        boolean;
  dispatch_station: string;
  kds_station:      string;
  show_in_pos:      boolean;
  category_type:    CategoryType;
}

export const CATEGORIES_ALL_KEY = ['categories', 'all'] as const;

export function useAllCategories() {
  return useQuery<CategoryRow[]>({
    queryKey: CATEGORIES_ALL_KEY,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name, slug, sort_order, is_active, dispatch_station, kds_station, show_in_pos, category_type')
        .is('deleted_at', null)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as CategoryRow[];
    },
  });
}
