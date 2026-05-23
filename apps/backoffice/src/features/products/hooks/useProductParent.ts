// apps/backoffice/src/features/products/hooks/useProductParent.ts
//
// Session 27c — Fetches the parent of a variant (Case 3 in VariantsPanel).
//
// Returns `null` when the parent isn't found (soft-deleted, etc.).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface ParentRow {
  id:   string;
  name: string;
}

export function useProductParent(parentId: string | null | undefined) {
  return useQuery<ParentRow | null>({
    queryKey: ['product-parent', parentId ?? ''] as const,
    enabled: parentId !== null && parentId !== undefined && parentId !== '',
    staleTime: 30_000,
    queryFn: async () => {
      if (parentId === null || parentId === undefined || parentId === '') return null;
      const { data, error } = await supabase
        .from('products')
        .select('id, name')
        .eq('id', parentId)
        .is('deleted_at', null)
        .maybeSingle();
      if (error !== null) throw error;
      if (data === null) return null;
      return { id: data.id, name: data.name } satisfies ParentRow;
    },
  });
}
