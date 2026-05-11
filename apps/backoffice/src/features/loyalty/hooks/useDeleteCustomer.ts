// apps/backoffice/src/features/loyalty/hooks/useDeleteCustomer.ts
//
// Soft-delete via SECURITY DEFINER RPC (session 12 migration 4). Direct
// `UPDATE customers SET deleted_at = now()` fails RLS because the
// auth_read SELECT policy filters deleted_at IS NULL rows and is applied
// as WITH CHECK after the UPDATE.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { LOYALTY_CUSTOMERS_QUERY_KEY } from './useLoyaltyCustomersList.js';

export function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const { error } = await supabase.rpc('soft_delete_customer', { p_customer_id: id });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: LOYALTY_CUSTOMERS_QUERY_KEY });
    },
  });
}
