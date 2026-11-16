// Désactivation / réactivation d'un compte (S1-07) — enveloppe la famille
// `set_user_active`. La désactivation coupe les sessions côté serveur.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { USERS_LIST_KEY, USER_DETAIL_KEY } from './useUsersList.js';

export interface SetUserActiveArgs {
  user_id:   string;
  is_active: boolean;
  reason:    string;
}

export interface SetUserActiveResult {
  is_active:             boolean;
  revoked_session_count: number;
  noop?:                 boolean;
}

export function useSetUserActive() {
  const qc = useQueryClient();
  return useMutation<SetUserActiveResult, Error, SetUserActiveArgs>({
    mutationFn: async (args) => {
      const { data, error } = await supabase.rpc('set_user_active_v1', {
        p_user_id:   args.user_id,
        p_is_active: args.is_active,
        p_reason:    args.reason,
      });
      if (error !== null) throw new Error(error.message);
      return data as unknown as SetUserActiveResult;
    },
    onSuccess: async (_data, vars) => {
      await qc.invalidateQueries({ queryKey: USERS_LIST_KEY });
      await qc.invalidateQueries({ queryKey: USER_DETAIL_KEY(vars.user_id) });
    },
  });
}

/** Message lisible pour les refus métier de la fonction ; le reste passe tel quel. */
export function setUserActiveErrorText(err: Error): string {
  if (err.message.includes('LAST_ADMIN_PROTECTED')) {
    return 'This account is the last active ADMIN/SUPER_ADMIN. Promote or reactivate another one first.';
  }
  if (err.message.includes('self_deactivation_forbidden')) return 'You cannot deactivate your own account.';
  if (err.message.includes('super_admin_only')) return 'Only a SUPER_ADMIN can change a SUPER_ADMIN account.';
  return err.message;
}
