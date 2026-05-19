// apps/backoffice/src/features/btob/hooks/useB2bCustomers.ts
//
// Session 24 / Phase 2.A.3 — B2B customer list for the create-order picker.
// Returns active B2B customers ordered by name. Used by CreateB2bOrderModal
// and RecordB2bPaymentModal.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface B2bCustomerOption {
  id:                  string;
  name:                string;
  b2b_company_name:    string | null;
  b2b_credit_limit:    number | null;
  b2b_current_balance: number;
}

export const B2B_CUSTOMERS_QUERY_KEY = ['b2b-customers'] as const;

export function useB2bCustomers() {
  return useQuery<B2bCustomerOption[]>({
    queryKey: B2B_CUSTOMERS_QUERY_KEY,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('id, name, b2b_company_name, b2b_credit_limit, b2b_current_balance')
        .is('deleted_at', null)
        .eq('customer_type', 'b2b')
        .order('b2b_company_name', { ascending: true, nullsFirst: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as B2bCustomerOption[];
    },
  });
}
