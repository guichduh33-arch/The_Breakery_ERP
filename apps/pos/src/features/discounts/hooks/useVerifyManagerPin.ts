// apps/pos/src/features/discounts/hooks/useVerifyManagerPin.ts
import { supabase } from '@/lib/supabase';
import type { VerifyResult } from '@breakery/ui';
import { setManagerPin } from '../managerPinHolder';

export function useVerifyManagerPin() {
  return async (pin: string): Promise<VerifyResult> => {
    try {
      const result = await supabase.functions.invoke('auth-verify-pin', {
        body: { pin, required_permission: 'sales.discount' },
      });
      const data = result.data as { verified_user_id: string } | null;
      const error = result.error as {
        context?: { status?: number };
        message?: string;
      } | null;
      if (error) {
        const status = error.context?.status;
        const msg = (error.message ?? '').toLowerCase();
        // S38 — distinguish account_locked (403 with body 'account_locked') from
        // plain permission_missing (403 without lockout body). The EF returns
        // 403 + body { error: 'account_locked' } when locked_until is in the future.
        if (status === 403) {
          if (msg.includes('account_locked')) return { ok: false, error: 'account_locked' };
          return { ok: false, error: 'permission_missing' };
        }
        if (status === 401 || status === 400) return { ok: false, error: 'wrong_pin' };
        return { ok: false, error: 'unknown' };
      }
      // S37 SEC-01 — RPC v11 re-validates this PIN server-side at checkout;
      // stash it in volatile memory until then (cleared by useCheckout).
      setManagerPin(pin);
      return { ok: true, userId: data?.verified_user_id ?? '' };
    } catch {
      return { ok: false, error: 'unknown' };
    }
  };
}
