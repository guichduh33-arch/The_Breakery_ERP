// apps/backoffice/src/features/accounting/hooks/useAccountIdByCode.ts
// Session 32 / Wave 3.G — resolve `accounts.id` UUID from an account code
// (e.g. '2110' for PB1 Payable). Used by reports that show a single-account
// KPI (PB1, future tax/loyalty cards) and want to drill into the GL.
//
// Cached aggressively (24h) since COA changes are exceptional.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export const ACCOUNT_ID_BY_CODE_QK = ['accounting', 'account-id-by-code'] as const;

export function useAccountIdByCode(code: string | null | undefined) {
  return useQuery<string | null>({
    queryKey: [...ACCOUNT_ID_BY_CODE_QK, code ?? null] as const,
    staleTime: 24 * 60 * 60_000,
    enabled: Boolean(code),
    queryFn: async () => {
      if (!code) return null;
      const { data, error } = await supabase
        .from('accounts')
        .select('id')
        .eq('code', code)
        .maybeSingle();
      if (error) throw error;
      return (data?.id as string | undefined) ?? null;
    },
  });
}
