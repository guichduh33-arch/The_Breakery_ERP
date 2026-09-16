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
  unit:           string | null;
}

export function useProductsForInventory(search: string) {
  const term = search.trim().slice(0, 64);
  // Échapper LIKE puis citer la valeur pour la grammaire OR : SKU avec "_" et
  // noms avec virgules/guillemets restent des valeurs, jamais des filtres.
  const pattern = JSON.stringify(`%${term.replace(/[\\%_]/g, '\\$&')}%`);
  return useQuery<ProductTypeaheadRow[]>({
    queryKey: ['products-typeahead', term] as const,
    enabled:  term.length >= 2,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, sku, name, current_stock, unit')
        .is('deleted_at', null)
        .eq('track_inventory', true)   // was .eq('is_active', true) — audit M1
        .or(`name.ilike.${pattern},sku.ilike.${pattern}`)
        .order('name')
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });
}
