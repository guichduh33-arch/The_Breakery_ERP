// apps/backoffice/src/features/products/hooks/useSetProductTestFlag.ts
//
// ADR-007 déc. 6 — wraps set_product_is_test_v1 (migration _205).
// Écriture immédiate (pas de passage par le draft/Save du GeneralPanel) :
// le flag est hors allowlist update_product_v2 à dessein — RPC dédiée,
// gate products.test_flag.update (ADMIN/SUPER_ADMIN).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface SetProductTestFlagArgs {
  productId: string;
  isTest: boolean;
}

export function useSetProductTestFlag() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, SetProductTestFlagArgs>({
    mutationFn: async ({ productId, isTest }) => {
      const { data, error } = await supabase.rpc('set_product_is_test_v1', {
        p_product_id: productId,
        p_is_test: isTest,
      });
      if (error !== null) throw new Error(error.message);
      return data;
    },
    onSuccess: async (_data, { productId }) => {
      await qc.invalidateQueries({ queryKey: ['products', 'detail', productId] });
      await qc.invalidateQueries({ queryKey: ['products', 'list'] });
    },
  });
}
