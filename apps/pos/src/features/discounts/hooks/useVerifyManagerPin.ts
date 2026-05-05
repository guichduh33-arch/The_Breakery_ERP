// apps/pos/src/features/discounts/hooks/useVerifyManagerPin.ts
import { supabase } from '@/lib/supabase';
import type { VerifyResult } from '@breakery/ui';

export function useVerifyManagerPin() {
  return async (pin: string): Promise<VerifyResult> => {
    try {
      const result = await supabase.functions.invoke('auth-verify-pin', {
        body: { pin, required_permission: 'sales.discount' },
      });
      const data = result.data as { verified_user_id: string } | null;
      const error = result.error as { context?: { status?: number } } | null;
      if (error) {
        const status = error.context?.status;
        if (status === 403) return { ok: false, error: 'permission_missing' };
        if (status === 401 || status === 400) return { ok: false, error: 'wrong_pin' };
        return { ok: false, error: 'unknown' };
      }
      return { ok: true, userId: data?.verified_user_id ?? '' };
    } catch {
      return { ok: false, error: 'unknown' };
    }
  };
}
