// apps/pos/src/features/lan/hooks/useCloudPing.ts
// Spec 006x lot 3 — détection de la coupure internet (spec §4.3 : « échec du
// ping cloud, pattern useTabletOffline »). Alimente useCloudStatusStore ;
// combiné à useHubConnectionStore par isOfflineMode().
//
// Deux signaux, comme useTabletOffline :
//   1. navigator.onLine (instantané mais optimiste) ;
//   2. ping HEAD /auth/v1/health toutes les 15 s (5 s timeout) — le vrai test.
// cloudOnline = les DEUX sont bons. useTabletOffline reste intact (bannière
// tablette) — ce hook est monté une fois par shell (Pos/Kds/Tablet/Display).

import { useEffect } from 'react';
import { useCloudStatusStore } from '../cloudStatusStore';

const PING_INTERVAL_MS = 15_000;
const PING_TIMEOUT_MS = 5_000;

async function pingCloud(supabaseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/health`, {
      method: 'HEAD',
      signal: controller.signal,
      cache: 'no-store',
    });
    return res.ok || res.status === 401; // 401 = l'hôte a répondu.
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function useCloudPing(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const env = import.meta.env as Record<string, string | undefined>;
    // Inerte sous vitest : un ping réseau réel dans les smoke tests jsdom
    // serait lent ET non déterministe (cloudOnline par défaut = true).
    if (env.MODE === 'test') return;
    const supabaseUrl = env.VITE_SUPABASE_URL ?? '';
    if (supabaseUrl === '') return;

    let cancelled = false;
    let pingOk = true;

    function publish(): void {
      const navOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
      useCloudStatusStore.getState().setCloudOnline(navOnline && pingOk);
    }

    async function doPing(): Promise<void> {
      const ok = await pingCloud(supabaseUrl);
      if (cancelled) return;
      pingOk = ok;
      publish();
    }

    function handleNavChange(): void {
      publish();
    }

    window.addEventListener('online', handleNavChange);
    window.addEventListener('offline', handleNavChange);
    void doPing();
    const handle = window.setInterval(() => { void doPing(); }, PING_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(handle);
      window.removeEventListener('online', handleNavChange);
      window.removeEventListener('offline', handleNavChange);
    };
  }, [enabled]);
}
