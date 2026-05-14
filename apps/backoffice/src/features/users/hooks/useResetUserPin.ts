// apps/backoffice/src/features/users/hooks/useResetUserPin.ts
// Session 13 / Phase 5.D — Wraps reset_user_pin_v1 RPC.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { USER_DETAIL_KEY } from './useUsersList.js';

export interface ResetUserPinArgs {
  user_id: string;
  new_pin: string;
}

export function useResetUserPin() {
  const qc = useQueryClient();
  return useMutation<void, Error, ResetUserPinArgs>({
    mutationFn: async (args) => {
      const { error } = await supabase.rpc('reset_user_pin_v1', {
        p_user_id: args.user_id,
        p_new_pin: args.new_pin,
      });
      if (error !== null) throw new Error(error.message);
    },
    onSuccess: async (_data, vars) => {
      await qc.invalidateQueries({ queryKey: USER_DETAIL_KEY(vars.user_id) });
    },
  });
}
