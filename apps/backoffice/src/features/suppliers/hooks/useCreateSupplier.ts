// apps/backoffice/src/features/suppliers/hooks/useCreateSupplier.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { SUPPLIERS_QUERY_KEY, type SupplierInsert, type SupplierRow } from './useSuppliersList.js';

export function useCreateSupplier() {
  const qc = useQueryClient();
  return useMutation<SupplierRow, Error, SupplierInsert>({
    mutationFn: async (values) => {
      const { data, error } = await supabase
        .from('suppliers')
        .insert(values)
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
