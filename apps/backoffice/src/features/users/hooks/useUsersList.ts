// apps/backoffice/src/features/users/hooks/useUsersList.ts
// Session 13 / Phase 5.D — List + detail queries for users.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface UserRow {
  id:                    string;
  auth_user_id:          string | null;
  employee_code:         string;
  full_name:             string;
  role_code:             string;
  is_active:             boolean;
  failed_login_attempts: number;
  locked_until:          string | null;
  last_login_at:         string | null;
  created_at:            string;
  updated_at:            string;
  deleted_at:            string | null;
}

export const USERS_LIST_KEY = ['users-list'] as const;
export const USER_DETAIL_KEY = (id: string) => ['user-detail', id] as const;

const SELECT_COLS =
  'id, auth_user_id, employee_code, full_name, role_code, is_active, ' +
  'failed_login_attempts, locked_until, last_login_at, created_at, updated_at, deleted_at';

/** Live list of non-deleted user_profiles. Gated server-side by users.read RLS. */
export function useUsersList(opts?: { includeDeleted?: boolean }) {
  const includeDeleted = opts?.includeDeleted ?? false;
  return useQuery<UserRow[]>({
    queryKey: includeDeleted ? ['users-list', 'with-deleted'] : USERS_LIST_KEY,
    staleTime: 30_000,
    queryFn: async () => {
      let q = supabase.from('user_profiles').select(SELECT_COLS);
      if (!includeDeleted) q = q.is('deleted_at', null);
      q = q.order('role_code', { ascending: true }).order('full_name', { ascending: true });
      const { data, error } = await q;
      if (error !== null) throw new Error(error.message);
      return (data as unknown as UserRow[]) ?? [];
    },
  });
}

/** Single profile row. Returns null if missing (or RLS-hidden). */
export function useUserDetail(id: string | undefined) {
  return useQuery<UserRow | null>({
    queryKey: USER_DETAIL_KEY(id ?? ''),
    enabled: typeof id === 'string' && id !== '',
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select(SELECT_COLS)
        .eq('id', id ?? '')
        .maybeSingle();
      if (error !== null) throw new Error(error.message);
      return (data as unknown as UserRow | null) ?? null;
    },
  });
}
