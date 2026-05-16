// apps/backoffice/src/features/products/hooks/useProductAllergens.ts
//
// Session 15 / Phase 5.C — Hooks for allergens on the BO product fiche.
//
// `useProductAllergens(productId)` reads the resolved (own + cascade) array
// from `view_product_allergens_resolved`.
//
// `useUpdateProductAllergens(productId)` mutates `products.allergens` and
// invalidates the resolved view + the catalog list so the table picks the
// change up immediately. UPDATE is gated by the `perm_update` RLS policy
// on `products` (requires the `products.update` permission).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AllergenType } from '@breakery/ui';
import { supabase } from '@/lib/supabase.js';

export const PRODUCT_ALLERGENS_KEY = (productId: string) =>
  ['products', 'allergens', productId] as const;

/**
 * Resolved allergens for a single product — own + propagated via the recipe
 * cascade. Backed by `view_product_allergens_resolved`.
 */
export function useProductAllergens(productId: string | null) {
  return useQuery<ReadonlyArray<AllergenType>>({
    queryKey: productId === null ? ['products', 'allergens', 'noop'] : PRODUCT_ALLERGENS_KEY(productId),
    enabled: productId !== null && productId !== '',
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (productId === null || productId === '') return [];
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- view types regenerate after migration apply
        .from('view_product_allergens_resolved' as any)
        .select('allergens')
        .eq('product_id', productId)
        .maybeSingle();
      if (error) throw error;
      const row = data as unknown as { allergens: AllergenType[] | null } | null;
      return row?.allergens ?? [];
    },
  });
}

/**
 * Mutate the self-declared `products.allergens` column. Triggers an
 * invalidation of the resolved view query (which then refetches) plus the
 * catalog list, so the product table & POS grid pick the change up.
 */
export function useUpdateProductAllergens(productId: string | null) {
  const qc = useQueryClient();
  return useMutation<void, Error, ReadonlyArray<AllergenType>>({
    mutationFn: async (allergens) => {
      if (productId === null || productId === '') {
        throw new Error('productId is required');
      }
      const { error } = await supabase
        .from('products')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- column added in Session 15 Phase 5.C migration 161
        .update({ allergens: [...allergens] } as any)
        .eq('id', productId);
      if (error) throw error;
    },
    onSuccess: async () => {
      if (productId === null) return;
      await Promise.all([
        qc.invalidateQueries({ queryKey: PRODUCT_ALLERGENS_KEY(productId) }),
        qc.invalidateQueries({ queryKey: ['products', 'detail', productId] }),
        qc.invalidateQueries({ queryKey: ['products', 'catalog'] }),
        // POS grid + product card use a distinct namespace.
        qc.invalidateQueries({ queryKey: ['pos', 'product-allergens'] }),
      ]);
    },
  });
}
