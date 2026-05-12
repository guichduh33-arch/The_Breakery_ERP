// apps/backoffice/src/features/suppliers/hooks/useUpdateSupplier.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { SUPPLIERS_QUERY_KEY, type SupplierRow, type SupplierUpdate } from './useSuppliersList.js';

export interface UpdateSupplierArgs {
  id: string;
  values: SupplierUpdate;
}

export function useUpdateSupplier() {
  const qc = useQueryClient();
  return useMutation<SupplierRow, Error, UpdateSupplierArgs>({
    mutationFn: async ({ id, values }) => {
      const { data, error } = await supabase
        .from('suppliers')
        .update(values)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: SUPPLIERS_QUERY_KEY });
    },
  });
}
