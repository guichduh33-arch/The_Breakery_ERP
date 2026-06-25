import { useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

/**
 * LOT 5 (POS P0 hardening, audit 2026-06-25) — reconnect safety net for
 * realtime-only hooks.
 *
 * Several POS hooks subscribe to `postgres_changes` and invalidate a query on
 * each event, but hold no `useQuery` of their own (so no `refetchInterval`
 * fallback). If the browser drops the realtime socket (Wi-Fi blip, tab sleep,
 * tablet backgrounded) an event can be missed silently and the cache goes
 * stale until the next manual action.
 *
 * This hook re-invalidates the given query keys whenever the browser fires the
 * `online` event (network came back). The realtime channel stays the nominal
 * path; this is purely a catch-up net so a lost event is recovered on
 * reconnect. Mirrors the `refetchInterval: 30_000` net already used on the
 * query-backed hooks (KDS, inbox, occupancy).
 *
 * Pass the SAME query keys the realtime handler invalidates.
 */
export function useReconnectInvalidate(queryKeys: readonly QueryKey[]): void {
  const qc = useQueryClient();

  useEffect(() => {
    const handleOnline = () => {
      for (const key of queryKeys) {
        void qc.invalidateQueries({ queryKey: key });
      }
    };

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
    // queryKeys is spread into the dep array so a caller passing an inline
    // array literal doesn't re-subscribe every render on identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, JSON.stringify(queryKeys)]);
}
