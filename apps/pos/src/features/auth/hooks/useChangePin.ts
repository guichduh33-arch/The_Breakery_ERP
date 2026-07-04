// apps/pos/src/features/auth/hooks/useChangePin.ts
// Session 19 / Phase 3.C — react-query mutation hook for self-change PIN.
//
// Hits the `auth-change-pin` Edge Function (Phase 2.B contract extended in S19)
// which returns `{ ok: true, weak: boolean, weak_reason?: PinWeakReason }`.
// Caller is expected to surface `weak`/`weak_reason` to the user (warn-only
// per D13 — wrong-current-PIN still rejects, weak NEW PIN only warns).

import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { PinWeakReason } from '@breakery/utils';

export interface ChangePinArgs {
  userId: string;
  currentPin: string;
  newPin: string;
}

export interface ChangePinResult {
  ok: true;
  weak: boolean;
  weak_reason?: PinWeakReason;
}

export function useChangePin() {
  return useMutation({
    mutationFn: async ({ userId, currentPin, newPin }: ChangePinArgs): Promise<ChangePinResult> => {
      // S25 hard cutover (session 59) — PINs travel via headers, never the
      // JSON body (request bodies get logged by PostgREST/pgaudit/proxies).
      const { data, error } = await supabase.functions.invoke('auth-change-pin', {
        body: { user_id: userId },
        headers: { 'x-current-pin': currentPin, 'x-new-pin': newPin },
      });
      if (error) {
        // Surface the EF error code (e.g. 'invalid_current_pin') for the modal
        // to map onto a user-friendly toast. Network errors get the raw message.
        const code = (error as { message?: string }).message ?? 'change_pin_failed';
        throw new Error(code);
      }
      if (!data?.ok) {
        throw new Error((data as { error?: string })?.error ?? 'change_pin_failed');
      }
      return data as ChangePinResult;
    },
  });
}
