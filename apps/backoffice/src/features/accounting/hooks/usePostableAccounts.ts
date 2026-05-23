// apps/backoffice/src/features/accounting/hooks/usePostableAccounts.ts
// Session 26b / Wave 2.A — Active + postable accounts for the JE line picker.
// Mirror du hook accounting-mappings/usePostableAccounts (S13) qui retourne
// code/name uniquement -- celui-ci retourne aussi id (UUID) requis par
// create_manual_je_v1 (line.account_id).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface PostableAccountOption {
  id:           string;
  code:         string;
  name:         string;
  account_class: number;
}

export const POSTABLE_ACCOUNTS_FULL_KEY = ['accounting', 'postable-accounts-full'] as const;

export function usePostableAccounts() {
  return useQuery<PostableAccountOption[]>({
    queryKey: POSTABLE_ACCOUNTS_FULL_KEY,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('id, code, name, account_class')
        .eq('is_postable', true)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('code', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PostableAccountOption[];
    },
  });
}
