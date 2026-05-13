// apps/backoffice/src/features/users/hooks/useUpdateUserRole.ts
// Session 13 / Phase 5.D — Wraps update_user_role_v1 RPC.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { USERS_LIST_KEY, USER_DETAIL_KEY } from './useUsersList.js';

export interface UpdateUserRoleArgs {
  user_id:       string;
  new_role_code: string;
  reason:        string;
}

export interface UpdateUserRoleResult {
  old_role:              string;
  new_role:              string;
  revoked_session_count: number;
  noop?:                 boolean;
}

export function useUpdateUserRole() {
  const qc = useQueryClient();
  return useMutation<UpdateUserRoleResult, Error, UpdateUserRoleArgs>({
    mutationFn: async (args) => {
      const { data, error } = await supabase.rpc('update_user_role_v1', {
        p_user_id:       args.user_id,
        p_new_role_code: args.new_role_code,
        p_reason:        args.reason,
      });
      if (error !== null) throw new Error(error.message);
      return data as unknown as UpdateUserRoleResult;
    },
    onSuccess: async (_data, vars) => {
      await qc.invalidateQueries({ queryKey: USERS_LIST_KEY });
      await qc.invalidateQueries({ queryKey: USER_DETAIL_KEY(vars.user_id) });
    },
  });
}
