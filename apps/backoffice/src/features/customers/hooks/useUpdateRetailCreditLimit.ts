// apps/backoffice/src/features/customers/hooks/useUpdateRetailCreditLimit.ts
//
// Session 62 Task 6 — persists customers.retail_credit_limit (server-gated
// tab ceiling for retail customers, `attach_tab_customer_v1` P0011). Direct
// table update — mirrors the persistence path of useUpdateCustomer (no RPC
// involved for this field).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

/** Narrow update chain — retail_credit_limit is not in types.generated yet
 * (S62 closeout regen pending, migration 20260710000112). Go through the
 * client object so `this` stays bound to `supabase` (eslint unbound-method). */
interface UpdateChain {
  eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
}
interface UpdateFn {
  update: (values: { retail_credit_limit: number | null }) => UpdateChain;
}

export function useUpdateRetailCreditLimit(customerId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<void, Error, number | null>({
    mutationFn: async (retailCreditLimit) => {
      if (customerId === undefined) throw new Error('id required');
      const sb = supabase as unknown as { from: (table: string) => UpdateFn };
      const { error } = await sb.from('customers')
        .update({ retail_credit_limit: retailCreditLimit })
        .eq('id', customerId);
      if (error !== null) throw new Error(error.message);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['customer-detail', customerId] });
    },
  });
}
