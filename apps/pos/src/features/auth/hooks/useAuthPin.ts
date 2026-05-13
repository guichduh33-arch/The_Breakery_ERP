// apps/pos/src/features/auth/hooks/useAuthPin.ts
// Session 13 / Phase 1.B — task 25-003 (drop client PIN fallback) +
//                            task 25-004 (error redaction).
//
// Thin wrapper around the auth store's login() action that exposes a
// PIN-entry-ready state shape. NO client-side PIN check, NO local PIN
// validation, NO `supabase.auth.setSession()` — the EF is the sole arbiter
// and its response is the only source of truth.

import { useCallback, useState } from 'react';

import { useAuthStore } from '@/stores/authStore';

export type PinAuthStatus = 'idle' | 'verifying' | 'success' | 'error';

export interface UseAuthPin {
  status: PinAuthStatus;
  error: string | null;
  verify: (userId: string, pin: string) => Promise<void>;
  reset: () => void;
}

/**
 * Pure EF-driven PIN verification. Calls the auth store login() which itself
 * hits `auth-verify-pin`. There is no offline fallback ; if the EF is
 * unreachable the user cannot log in. This is intentional (security > UX).
 *
 * @example
 * ```tsx
 * const { status, error, verify } = useAuthPin();
 * await verify(userId, '123456');
 * if (status === 'success') navigate('/pos');
 * ```
 */
export function useAuthPin(): UseAuthPin {
  const login = useAuthStore((s) => s.login);
  const [status, setStatus] = useState<PinAuthStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const verify = useCallback(async (userId: string, pin: string) => {
    setStatus('verifying');
    setError(null);
    try {
      await login(userId, pin);
      setStatus('success');
    } catch (err) {
      // Generic message — the EF + store have already collapsed identity
      // failures to `invalid_credentials`. Surface that and nothing else.
      const e = err as { message?: string; details?: { error?: string } };
      const raw = e.details?.error ?? e.message ?? 'invalid_credentials';
      setError(raw === 'rate_limited' || raw === 'account_locked' ? raw : 'invalid_credentials');
      setStatus('error');
    }
  }, [login]);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);

  return { status, error, verify, reset };
}
