// apps/backoffice/src/features/inventory/hooks/useProductsForInventory.ts
//
// Typeahead helper for inventory modals. Returns the products matching a
// case-insensitive name fragment (limit 20). Disabled until the user types
// at least 2 characters to keep the round-trip cost predictable.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface ProductTypeaheadRow {
  id:             string;
  sku:            string;
  name:           string;
  current_stock:  number;
}

// PostgREST `.or()` and `.ilike()` treat `%` and `_` as wildcards; strip them
// before interpolation to avoid surprising matches.
const ILIKE_UNSAFE = /[%_\\]/g;
function sanitize(term: string): string {
  return term.replace(ILIKE_UNSAFE, '').slice(0, 64);
}

export function useProductsForInventory(search: string) {
  const term = sanitize(search.trim());
  return useQuery<ProductTypeaheadRow[]>({
    queryKey: ['products-typeahead', term] as const,
    enabled:  term.length >= 2,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, sku, name, current_stock')
        .is('deleted_at', null)
        .eq('track_inventory', true)   // was .eq('is_active', true) — audit M1
        .ilike('name', `%${term}%`)
        .order('name')
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });
}
