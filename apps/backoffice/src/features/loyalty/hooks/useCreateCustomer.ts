// apps/backoffice/src/features/loyalty/hooks/useCreateCustomer.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CustomerFormValues } from '@breakery/ui';
import { supabase } from '@/lib/supabase.js';
import { LOYALTY_CUSTOMERS_QUERY_KEY } from './useLoyaltyCustomersList.js';

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation<void, Error, CustomerFormValues>({
    mutationFn: async (values) => {
      const { error } = await supabase.from('customers').insert({
        name:  values.name,
        phone: values.phone,
        email: values.email,
        customer_type: 'retail',
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: LOYALTY_CUSTOMERS_QUERY_KEY });
    },
  });
}
