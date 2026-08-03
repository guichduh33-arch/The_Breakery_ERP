// apps/backoffice/src/features/loyalty/hooks/useUpdateCustomer.ts
// ADR-020 déc. 2 (2026-08-03) — l'UPDATE direct est mort : le GRANT colonne de
// `authenticated` est retiré. La modification passe par `update_customer_v1`,
// gatée sur `customers.update`, qui écrit le diff avant/après dans `audit_logs`.
// Les champs financiers n'y entrent pas — ils relèvent de
// `update_customer_credit_terms_v1` (décision 1) et la RPC les refuse.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CustomerFormValues } from '@breakery/ui';
import { supabase } from '@/lib/supabase.js';
import { LOYALTY_CUSTOMERS_QUERY_KEY } from './useLoyaltyCustomersList.js';

export function useUpdateCustomer() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; values: CustomerFormValues }>({
    mutationFn: async ({ id, values }) => {
      const { error } = await supabase.rpc('update_customer_v1', {
        p_customer_id: id,
        p_patch: { name: values.name, phone: values.phone, email: values.email },
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: LOYALTY_CUSTOMERS_QUERY_KEY });
    },
  });
}
