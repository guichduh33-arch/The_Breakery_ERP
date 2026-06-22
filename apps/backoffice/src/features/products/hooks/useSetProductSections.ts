// apps/backoffice/src/features/products/hooks/useSetProductSections.ts
//
// Wraps set_product_sections_v1 (REPLACE semantics — the passed list becomes the
// product's full section membership). Gate: products.sections.update (MANAGER+).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { productSectionsKey } from './useProductSections.js';

export interface SetProductSectionsPayload {
  sectionIds: string[];
  /** Primary section — must be one of sectionIds, or null when the list is empty. */
  primarySectionId: string | null;
}

export function useSetProductSections(productId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, SetProductSectionsPayload>({
    mutationFn: async (payload) => {
      const { data, error } = await supabase.rpc('set_product_sections_v1', {
        p_product_id:         productId,
        p_section_ids:        payload.sectionIds,
        // The RPC accepts a NULL primary (uuid), but the generated type marks the
        // arg required (no SQL DEFAULT). Cast so null is allowed at the boundary.
        p_primary_section_id: payload.primarySectionId as unknown as string,
      });
      if (error !== null) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: productSectionsKey(productId) });
    },
  });
}
