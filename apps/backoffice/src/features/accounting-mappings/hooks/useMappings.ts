// apps/backoffice/src/features/accounting-mappings/hooks/useMappings.ts
//
// Session 13 / Phase 6.C — Read all `accounting_mappings` rows and join the
// related `accounts` (code, name, is_postable, is_active) so the admin UI
// can render the resolved account name + flag non-postable / inactive
// accounts inline. `accounting.read` gates this query at the RLS layer
// (read policy `auth_read` from migration 000001).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface MappingRow {
  mapping_key:  string;
  account_code: string;
  description:  string | null;
  is_active:    boolean;
  updated_at:   string;
  account_name: string | null;
  account_is_postable: boolean | null;
  account_is_active:   boolean | null;
}

export const MAPPINGS_QUERY_KEY = ['accounting-mappings'] as const;

export function useMappings() {
  return useQuery<MappingRow[]>({
    queryKey: MAPPINGS_QUERY_KEY,
    queryFn: async () => {
      // Supabase auto-joins via `accounts!accounting_mappings_account_code_fkey`
      // — the FK relation. We select the join + flatten in JS.
      const { data, error } = await supabase
        .from('accounting_mappings')
        .select(
          'mapping_key, account_code, description, is_active, updated_at, accounts:account_code (name, is_postable, is_active)'
        )
        .order('mapping_key', { ascending: true });
      if (error) throw error;
      // `accounts:account_code` joins one-to-one. Supabase-js returns it as an
      // object (not array) because the FK is non-array. Coerce defensively.
      interface JoinedRow {
        mapping_key:  string;
        account_code: string;
        description:  string | null;
        is_active:    boolean;
        updated_at:   string;
        accounts: { name: string; is_postable: boolean; is_active: boolean } | null;
      }
      return ((data ?? []) as unknown as JoinedRow[]).map((r) => ({
        mapping_key:         r.mapping_key,
        account_code:        r.account_code,
        description:         r.description,
        is_active:           r.is_active,
        updated_at:          r.updated_at,
        account_name:        r.accounts?.name ?? null,
        account_is_postable: r.accounts?.is_postable ?? null,
        account_is_active:   r.accounts?.is_active ?? null,
      }));
    },
  });
}

export interface AccountOption {
  code:        string;
  name:        string;
  is_postable: boolean;
  is_active:   boolean;
}

export const POSTABLE_ACCOUNTS_QUERY_KEY = ['postable-accounts'] as const;

/**
 * All postable + active accounts. Used by the edit dialog's account picker.
 */
export function usePostableAccounts() {
  return useQuery<AccountOption[]>({
    queryKey: POSTABLE_ACCOUNTS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('code, name, is_postable, is_active')
        .eq('is_postable', true)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('code', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}
