// apps/backoffice/src/features/auth/hooks/useLoginUsers.ts
// Vague 0 / Tâche 3b — dynamic login picker (was hardcoded to 2 seed users).
//
// Calls `list_login_users_v1`, a NEW anon-callable RPC (S58 migration
// `20260710000099`). This is called PRE-AUTH — no PIN JWT has been issued
// yet, so the request rides the anon key via the default supabase-js
// headers (the custom fetch wrapper in `packages/supabase` only overrides
// the Authorization/apikey headers once `setSupabaseAccessToken` has been
// called ; before that it falls through to the client's default anon
// headers, which the DB grants EXECUTE to for this one function).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface LoginUser {
  id: string;
  display_name: string;
  role: string;
}

export const LOGIN_USERS_KEY = ['login-users'] as const;

/**
 * Active, non-deleted staff for the pre-auth login picker (BackOffice
 * shared-terminal login). Minimal exposure by design — see
 * `list_login_users_v1` COMMENT in the migration.
 */
export function useLoginUsers() {
  return useQuery<LoginUser[]>({
    queryKey: LOGIN_USERS_KEY,
    staleTime: 30_000,
    retry: 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_login_users_v1');
      if (error !== null) throw new Error(error.message);
      return (data as unknown as LoginUser[]) ?? [];
    },
  });
}
