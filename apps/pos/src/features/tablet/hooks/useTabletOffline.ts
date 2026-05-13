// apps/pos/src/features/tablet/hooks/useTabletOffline.ts
//
// Session 13 / Phase 4.D — Tablet polish.
//
// Detect online/offline state for the kiosk-style tablet. Two signals are
// combined:
//
//   1. `navigator.onLine` from the browser (instant, but unreliable —
//      Chrome will tell you "online" even when DNS resolution is dead).
//   2. Periodic lightweight ping to Supabase (REST HEAD `/auth/v1/health`)
//      that confirms the round-trip works.
//
// The hook exposes `{ isOnline, lastSync }` :
//   - `isOnline` flips false whenever EITHER signal goes down. Recovery
//     requires BOTH to be healthy.
//   - `lastSync` is the timestamp of the last successful ping. Useful for
//     the offline banner copy ("Last synced 2 minutes ago").
//
// The realtime channel that the tablet uses
// (`useTabletOrderStatusListener`) is independent — we do not gate on it
// because Supabase keeps its WebSocket alive even on temporary outages.

import { useEffect, useState } from 'react';

const PING_INTERVAL_MS = 30_000; // 30s — cheap, well under the 60s realtime keep-alive
const PING_TIMEOUT_MS  = 5_000;  // 5s — give up early on dead network

export interface TabletOfflineState {
  /** True when both `navigator.onLine` and a recent ping succeeded. */
  isOnline: boolean;
  /** Last successful ping timestamp, or null if never. */
  lastSync: Date | null;
}

async function pingSupabase(supabaseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/health`, {
      method: 'HEAD',
      signal: controller.signal,
      // Don't send auth headers — health endpoint is public + we want a
      // pure network/DNS check.
      cache: 'no-store',
    });
    return res.ok || res.status === 401; // 401 still means the host answered
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function useTabletOffline(): TabletOfflineState {
  const [navOnline, setNavOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [pingOnline, setPingOnline] = useState<boolean>(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  useEffect(() => {
    function handleOnline() { setNavOnline(true); }
    function handleOffline() { setNavOnline(false); }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }
    return undefined;
  }, []);

  useEffect(() => {
    const supabaseUrl =
      (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) ?? '';
    if (supabaseUrl === '') return;

    let cancelled = false;

    async function doPing() {
      const ok = await pingSupabase(supabaseUrl);
      if (cancelled) return;
      setPingOnline(ok);
      if (ok) setLastSync(new Date());
    }

    void doPing();
    const handle = setInterval(() => { void doPing(); }, PING_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, []);

  return {
    isOnline: navOnline && pingOnline,
    lastSync,
  };
}
