// apps/backoffice/src/features/suppliers/hooks/useDeleteSupplier.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { SUPPLIERS_QUERY_KEY } from './useSuppliersList.js';

export function useDeleteSupplier() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('suppliers')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: SUPPLIERS_QUERY_KEY });
    },
  });
}
