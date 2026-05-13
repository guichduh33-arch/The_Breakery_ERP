// apps/pos/src/features/display/hooks/useKioskAuth.ts
// Session 13 / Phase 1.B — D18.
//
// Display surface kiosk auth. On mount:
//   1. Attempt to mint a kiosk JWT (scope='display') via kiosk-issue-jwt EF.
//   2. Schedule a refresh 10 min before expiry.
//   3. On failure (network/unpaired/revoked), surface `status='pin_fallback'`
//      so the UI can offer a staff PIN login per K7 (lead decision).

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  obtainKioskJwt,
  nextRefreshDelayMs,
  type KioskAuthState,
} from '@/lib/kioskAuth';

export function useKioskAuth(): KioskAuthState & {
  retry: () => Promise<void>;
} {
  const [state, setState] = useState<KioskAuthState>({
    status: 'idle',
    expiresAt: null,
    error: null,
  });
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const acquire = useCallback(async () => {
    setState((s) => ({ ...s, status: 'authenticating', error: null }));
    const result = await obtainKioskJwt('display');
    if (result.ok) {
      setState({
        status: 'authenticated',
        expiresAt: result.response.expires_at,
        error: null,
      });
      const delayMs = nextRefreshDelayMs(result.response.expires_at);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      if (delayMs && delayMs > 0) {
        refreshTimerRef.current = setTimeout(() => {
          void acquire();
        }, delayMs);
      }
      return;
    }
    // Per K7: surface pin_fallback when kiosk-issue-jwt is unreachable / refused.
    setState({
      status: 'pin_fallback',
      expiresAt: null,
      error: (result.error as { error?: string }).error ?? 'kiosk_unavailable',
    });
  }, []);

  useEffect(() => {
    void acquire();
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [acquire]);

  return { ...state, retry: acquire };
}
