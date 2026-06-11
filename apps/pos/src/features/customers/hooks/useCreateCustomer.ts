// apps/pos/src/features/customers/hooks/useCreateCustomer.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Customer } from '@breakery/domain';

interface CreateCustomerInput {
  name: string;
  phone: string;
  email?: string;
}

/**
 * S37 C5 (SEC-03) — walk-in creation goes through the SECURITY DEFINER RPC
 * `create_customer_v2` instead of a direct INSERT, so it survives the
 * `customers.read` gate. The default customer category is now assigned
 * server-side (migration `_019`), replacing the old client-side
 * resolveDefaultCategoryId pre-fetch.
 */
export function useCreateCustomer() {
  const queryClient = useQueryClient();

  return useMutation<Customer, Error, CreateCustomerInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('create_customer_v2', {
        p_name: input.name,
        p_phone: input.phone,
        ...(input.email ? { p_email: input.email } : {}),
      });
      if (error) throw error;
      const row = (data ?? [])[0];
      if (!row) throw new Error('create_customer_v2 returned no row');
      return row as unknown as Customer;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });
}
