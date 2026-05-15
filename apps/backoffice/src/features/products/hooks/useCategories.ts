// apps/backoffice/src/features/products/hooks/useCategories.ts
//
// Session 14 / Phase 4.B — Loads active product categories for the filter
// select, the product detail "category" dropdown, and the category
// management surface.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { CategoryOption } from '../types.js';

export function useCategories() {
  return useQuery<CategoryOption[]>({
    queryKey: ['products', 'categories'] as const,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name, slug, is_active, sort_order')
        .is('deleted_at', null)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as CategoryOption[];
    },
  });
}
