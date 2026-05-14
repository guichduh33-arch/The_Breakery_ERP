// apps/pos/src/features/kds/hooks/useKioskAuth.ts
// Session 13 / Phase 1.B — D18. KDS scope variant.
//
// Mirror of display/useKioskAuth with scope='kds'. The kitchen display can
// also accept a staff PIN fallback (K7) — useful when a manager wants to
// supervise from the kitchen tablet.

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
    const result = await obtainKioskJwt('kds');
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
