// apps/backoffice/src/features/products/hooks/useUpsertProductModifiers.ts
//
// Wraps upsert_product_modifiers_v1 (S27, gate products.modifiers.update).
// REPLACE semantics: the RPC soft-deletes the product's current modifiers and
// re-inserts from the serialized payload. Invalidates both the admin load key
// and the POS-shared ['product-modifiers'] keys.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  serializeModifierGroups,
  type EditableModifierGroup,
} from '@breakery/domain';
import { supabase } from '@/lib/supabase.js';
import { productModifiersAdminKey } from './useProductModifiersAdmin.js';

export function useUpsertProductModifiers(productId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, EditableModifierGroup[]>({
    mutationFn: async (groups) => {
      const { data, error } = await supabase.rpc('upsert_product_modifiers_v1', {
        p_product_id: productId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        p_groups: serializeModifierGroups(groups) as any,
      });
      if (error !== null) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: productModifiersAdminKey(productId) });
      void qc.invalidateQueries({ queryKey: ['product-modifiers'] });
    },
  });
}
