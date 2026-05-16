// apps/backoffice/src/features/products/hooks/useResolvedAllergensMap.ts
//
// Session 15 / Phase 5.C — Batch fetch of resolved allergens for every product
// in the catalog list. Reads the full `view_product_allergens_resolved` table
// in one round-trip ; cardinality is < 200 rows in The Breakery context.
// Returns a Map<product_id, AllergenType[]> so callers can render badges
// without an N+1 query.

import { useQuery } from '@tanstack/react-query';
import type { AllergenType } from '@breakery/ui';
import { supabase } from '@/lib/supabase.js';

export const RESOLVED_ALLERGENS_MAP_KEY = ['products', 'allergens', 'resolved-map'] as const;

export function useResolvedAllergensMap() {
  return useQuery<Map<string, AllergenType[]>>({
    queryKey: RESOLVED_ALLERGENS_MAP_KEY,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- view types regenerate after migration apply
        .from('view_product_allergens_resolved' as any)
        .select('product_id, allergens');
      if (error) throw error;
      const rows = (data ?? []) as unknown as Array<{ product_id: string; allergens: AllergenType[] | null }>;
      const map = new Map<string, AllergenType[]>();
      for (const row of rows) {
        map.set(row.product_id, row.allergens ?? []);
      }
      return map;
    },
  });
}
