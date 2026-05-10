// apps/backoffice/src/features/loyalty/hooks/useUpdateCustomer.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CustomerFormValues } from '@breakery/ui';
import { supabase } from '@/lib/supabase.js';
import { LOYALTY_CUSTOMERS_QUERY_KEY } from './useLoyaltyCustomersList.js';

export function useUpdateCustomer() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; values: CustomerFormValues }>({
    mutationFn: async ({ id, values }) => {
      const { error } = await supabase
        .from('customers')
        .update({ name: values.name, phone: values.phone, email: values.email })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: LOYALTY_CUSTOMERS_QUERY_KEY });
    },
  });
}
