// apps/pos/src/features/discounts/hooks/useVerifyManagerPin.ts
// S43 (P0-1c, DEV-S43-B1-01) : fetch brut vers la nouvelle EF verify-manager-pin —
// functions.invoke hérite du header global `x-app` (CORS) et auth-verify-pin est
// l'EF de LOGIN (exige user_id) : le flux discount est PIN-only. PIN en header
// x-manager-pin (pattern S25), lockout SEC-07 per-IP partagé avec void/cancel/refund.
import { supabaseUrl } from '@/lib/supabase';
import { getAccessToken } from '@/lib/accessToken';
import type { VerifyResult } from '@breakery/ui';
import { setManagerPin } from '../managerPinHolder';

export function useVerifyManagerPin() {
  // PinVerificationModal calls verifyFn(pin, requiredPermission) — thread it so
  // future call-sites can gate on other permissions (e.g. orders.void).
  return async (pin: string, requiredPermission: string = 'sales.discount'): Promise<VerifyResult> => {
    try {
      const accessToken = await getAccessToken();
      const res = await fetch(`${supabaseUrl}/functions/v1/verify-manager-pin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          // S25 — manager PIN in header, never the body.
          'x-manager-pin': pin,
        },
        body: JSON.stringify({ required_permission: requiredPermission }),
      });
      const body = await res.json().catch(() => ({})) as { verified_user_id?: string };
      if (res.ok) {
        // S37 SEC-01 — RPC v11 re-validates this PIN server-side at checkout;
        // stash it in volatile memory until then (cleared by useCheckout).
        setManagerPin(pin);
        return { ok: true, userId: body.verified_user_id ?? '' };
      }
      // SEC-07 — 429 means the per-IP manager-pin fail bucket is full: surface
      // it as the lockout UX (same copy as the account_locked path).
      if (res.status === 429) return { ok: false, error: 'account_locked' };
      if (res.status === 403) return { ok: false, error: 'permission_missing' };
      if (res.status === 401 || res.status === 400) return { ok: false, error: 'wrong_pin' };
      return { ok: false, error: 'unknown' };
    } catch {
      return { ok: false, error: 'unknown' };
    }
  };
}
