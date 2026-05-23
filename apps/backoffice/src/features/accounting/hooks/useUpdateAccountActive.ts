// apps/backoffice/src/features/accounting/hooks/useUpdateAccountActive.ts
// Session 26b / Wave 1.D — Wraps update_account_active_v1 RPC.
// Gate : permission `accounting.coa.write` (SUPER_ADMIN only) enforced by RPC.
// Audit_log row inserted by RPC.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { CHART_OF_ACCOUNTS_KEY } from './useChartOfAccounts.js';

export interface UpdateAccountActiveArgs {
  accountId: string;
  isActive:  boolean;
}

export function useUpdateAccountActive() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, UpdateAccountActiveArgs>({
    mutationFn: async ({ accountId, isActive }) => {
      const { data, error } = await supabase.rpc('update_account_active_v1', {
        p_account_id: accountId,
        p_is_active:  isActive,
      });
      if (error !== null) throw new Error(error.message);
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: CHART_OF_ACCOUNTS_KEY });
    },
  });
}
