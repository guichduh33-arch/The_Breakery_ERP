// apps/pos/src/features/display/hooks/useKioskAuth.ts
// Renouvellement du jeton d'appareil et reconnexion après une panne réseau.
// Le nom historique pin_fallback désigne désormais le formulaire d'appairage.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabaseAccessToken, setSupabaseKioskAccessToken } from '@breakery/supabase';

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
  const generation = useRef(0);
  const ownedToken = useRef<string | null>(null);

  const acquire = useCallback(async () => {
    const current = ++generation.current;
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    setState((s) => ({ ...s, status: 'authenticating', error: null }));
    const result = await obtainKioskJwt('display');
    if (current !== generation.current) return;
    if (result.ok) {
      ownedToken.current = result.response.access_token;
      setSupabaseKioskAccessToken(result.response.access_token);
      setState({
        status: 'authenticated',
        expiresAt: result.response.expires_at,
        error: null,
      });
      const delayMs = nextRefreshDelayMs(result.response.expires_at);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => { void acquire(); }, Math.max(delayMs ?? 1_000, 1_000));
      return;
    }
    if (ownedToken.current && getSupabaseAccessToken() === ownedToken.current) setSupabaseKioskAccessToken(null);
    setState({
      status: 'pin_fallback',
      expiresAt: null,
      error: (result.error).error ?? 'kiosk_unavailable',
    });
    if (result.status !== 401 && result.error.error !== 'kiosk_unpaired') {
      refreshTimerRef.current = setTimeout(() => { void acquire(); }, 15_000);
    }
  }, []);

  const release = useCallback(() => {
    generation.current++;
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    if (ownedToken.current && getSupabaseAccessToken() === ownedToken.current) setSupabaseKioskAccessToken(null);
  }, []);
  useEffect(() => {
    void acquire();
    return release;
  }, [acquire, release]);

  return { ...state, retry: acquire };
}
