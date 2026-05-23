// apps/backoffice/src/features/accounting/hooks/useChartOfAccounts.ts
// Session 26b / Wave 1.D — SELECT direct sur accounts via auth_read policy.
// Gate UI : permission `accounting.coa.read` (route-level PermissionGate).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface AccountRow {
  id:                string;
  code:              string;
  name:              string;
  account_class:     number;
  account_type:      string;
  balance_type:      string;
  is_postable:       boolean;
  is_system:         boolean;
  is_active:         boolean;
  cash_flow_section: string;
}

export const CHART_OF_ACCOUNTS_KEY = ['accounting', 'chart-of-accounts'] as const;

export function useChartOfAccounts() {
  return useQuery<AccountRow[]>({
    queryKey: CHART_OF_ACCOUNTS_KEY,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select(
          'id, code, name, account_class, account_type, balance_type, is_postable, is_system, is_active, cash_flow_section'
        )
        .is('deleted_at', null)
        .order('code', { ascending: true });
      if (error) throw error;
      return (data ?? []) as AccountRow[];
    },
  });
}
