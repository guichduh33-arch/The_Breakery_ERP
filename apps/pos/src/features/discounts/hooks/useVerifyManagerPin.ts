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
      // supabase-js wraps non-2xx in a FunctionsHttpError whose `message` is the
      // generic "Edge Function returned a non-2xx status code". The real body
      // (e.g. { error: 'account_locked' }) is on `context`, a Response object —
      // we must read it explicitly to distinguish lockout from permission_missing.
      const error = result.error as {
        context?: Response & { status?: number };
      } | null;
      if (error) {
        const status = error.context?.status;
        let bodyError = '';
        try {
          if (error.context && typeof error.context.json === 'function') {
            const body = await error.context.clone().json() as { error?: string };
            bodyError = (body.error ?? '').toLowerCase();
          }
        } catch { /* body not JSON — fall through to status-based mapping */ }
        // S38 — distinguish account_locked (403 with body 'account_locked') from
        // plain permission_missing (403 without lockout body). The EF returns
        // 403 + body { error: 'account_locked' } when locked_until is in the future.
        if (status === 403) {
          if (bodyError === 'account_locked') return { ok: false, error: 'account_locked' };
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
