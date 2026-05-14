// apps/backoffice/src/features/users/hooks/useDeleteUser.ts
// Session 13 / Phase 5.D — Wraps delete_user_v1 RPC (soft-delete + last-admin guard).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { USERS_LIST_KEY, USER_DETAIL_KEY } from './useUsersList.js';

export interface DeleteUserArgs {
  user_id: string;
  reason:  string;
}

export interface DeleteUserResult {
  deleted_at:            string;
  revoked_session_count: number;
}

/**
 * The RPC raises SQLSTATE P0001 with message starting "LAST_ADMIN_PROTECTED..."
 * when the target is the sole remaining admin/super-admin. The UI surfaces
 * that case via `error.message.includes('LAST_ADMIN_PROTECTED')`.
 */
export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation<DeleteUserResult, Error, DeleteUserArgs>({
    mutationFn: async (args) => {
      const { data, error } = await supabase.rpc('delete_user_v1', {
        p_user_id: args.user_id,
        p_reason:  args.reason,
      });
      if (error !== null) throw new Error(error.message);
      return data as unknown as DeleteUserResult;
    },
    onSuccess: async (_data, vars) => {
      await qc.invalidateQueries({ queryKey: USERS_LIST_KEY });
      await qc.invalidateQueries({ queryKey: USER_DETAIL_KEY(vars.user_id) });
    },
  });
}

export function isLastAdminError(err: Error): boolean {
  return err.message.includes('LAST_ADMIN_PROTECTED');
}
