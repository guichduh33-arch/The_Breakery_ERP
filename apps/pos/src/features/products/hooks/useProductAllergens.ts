// apps/pos/src/features/products/hooks/useProductAllergens.ts
//
// Session 15 / Phase 5.C — POS read of resolved allergens for the product
// grid. Returns a Map<product_id, AllergenType[]> from a single round-trip
// to `view_product_allergens_resolved` (cardinality < 200 rows). Keys are
// then looked up in O(1) by ProductCard.
//
// Spec ref: docs/workplan/specs/2026-05-15-session-15-spec.md §D14.

import { useQuery } from '@tanstack/react-query';
import type { AllergenType } from '@breakery/ui';
import { supabase } from '@/lib/supabase';

export const POS_PRODUCT_ALLERGENS_KEY = ['pos', 'product-allergens'] as const;

/**
 * Fetches resolved allergens for every product. Used by ProductGrid +
 * ProductCard to overlay mini badges. Refetches every 5 min (stale-time).
 */
export function useProductAllergensMap() {
  return useQuery<Map<string, ReadonlyArray<AllergenType>>>({
    queryKey: POS_PRODUCT_ALLERGENS_KEY,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- view types regenerate after migration apply
        .from('view_product_allergens_resolved' as any)
        .select('product_id, allergens');
      if (error) throw error;
      const rows = (data ?? []) as unknown as Array<{ product_id: string; allergens: AllergenType[] | null }>;
      const map = new Map<string, ReadonlyArray<AllergenType>>();
      for (const row of rows) {
        map.set(row.product_id, row.allergens ?? []);
      }
      return map;
    },
  });
}
