// apps/backoffice/src/features/users/hooks/useResetUserPin.ts
// Session 13 / Phase 5.D — Wraps reset_user_pin_v1 RPC.
// Session 19 / Phase 3.B — Returns weak-PIN feedback derived from the
// pure @breakery/utils evaluator after the RPC succeeds. The RPC itself
// remains VOID (no migration in S19) ; strength evaluation is client-side
// here so the BO admin-reset path mirrors the auth-change-pin EF response
// shape consumed by POS (D14 + D16). Backward compatible : callers ignoring
// `weak` / `weak_reason` keep working.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { evaluatePinStrength, type PinWeakReason } from '@breakery/utils';
import { supabase } from '@/lib/supabase.js';
import { USER_DETAIL_KEY } from './useUsersList.js';

export interface ResetUserPinArgs {
  user_id: string;
  new_pin: string;
}

export interface ResetUserPinResult {
  ok: true;
  weak: boolean;
  weak_reason?: PinWeakReason;
}

export function useResetUserPin() {
  const qc = useQueryClient();
  return useMutation<ResetUserPinResult, Error, ResetUserPinArgs>({
    mutationFn: async (args) => {
      const { error } = await supabase.rpc('reset_user_pin_v1', {
        p_user_id: args.user_id,
        p_new_pin: args.new_pin,
      });
      if (error !== null) throw new Error(error.message);
      const strength = evaluatePinStrength(args.new_pin);
      const result: ResetUserPinResult = { ok: true, weak: strength.weak };
      if (strength.reason !== null) {
        result.weak_reason = strength.reason;
      }
      return result;
    },
    onSuccess: async (_data, vars) => {
      await qc.invalidateQueries({ queryKey: USER_DETAIL_KEY(vars.user_id) });
    },
  });
}
