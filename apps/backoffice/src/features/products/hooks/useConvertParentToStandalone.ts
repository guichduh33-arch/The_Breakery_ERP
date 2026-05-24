// apps/backoffice/src/features/products/hooks/useConvertParentToStandalone.ts
//
// Session 27c — Wraps `convert_parent_to_standalone_v1`. When a parent has 0 or
// 1 active variant remaining, dissolves the parent grouping back into the (last)
// variant or the parent's own SKU. Returns the surviving product id.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export function useConvertParentToStandalone() {
  const qc = useQueryClient();
  return useMutation<string, Error, string>({
    mutationFn: async (parentId) => {
      const { data, error } = await supabase.rpc('convert_parent_to_standalone_v1', {
        p_parent_id: parentId,
      });
      if (error !== null) throw new Error(error.message);
      return data as string;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['products'] }),
        qc.invalidateQueries({ queryKey: ['product-variants'] }),
      ]);
    },
  });
}
