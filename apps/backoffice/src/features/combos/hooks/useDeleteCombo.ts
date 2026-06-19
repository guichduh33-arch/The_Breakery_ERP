// apps/backoffice/src/features/combos/hooks/useDeleteCombo.ts
//
// Session 47 — mutation hook wrapping delete_combo_v1 RPC.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface DeleteComboResult {
  combo_product_id: string;
  deleted: boolean;
}

export function useDeleteCombo() {
  const qc = useQueryClient();

  return useMutation<DeleteComboResult, Error, string>({
    mutationFn: async (comboProductId) => {
      const { data, error } = await supabase.rpc('delete_combo_v1', {
        p_combo_product_id: comboProductId,
      });
      if (error) throw error;
      return data as unknown as DeleteComboResult;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['combos'] });
    },
  });
}
