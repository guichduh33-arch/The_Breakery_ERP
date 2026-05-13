// apps/pos/src/features/display/hooks/useDisplayRealtime.ts
//
// Session 13 / Phase 4.C — D-4C-3 (D19 channel uniqueness).
//
// Subscribe to `orders` postgres_changes so the customer display reflects
// status changes (new paid order, completed, voided) in real-time. Each
// event invalidates the `display-orders` query so the queue ticker
// refreshes within <1s.
//
// D19 — Channel-name uniqueness pattern (Wave 1 hotfix). Under StrictMode
// React double-invokes effects in dev ; with a static channel name the
// second mount's .on() runs against the still-subscribed channel from
// the first mount (`removeChannel` is async). The per-mount UUID
// (computed once via `useMemo`) guarantees a fresh channel identifier.

import { useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';

export const DISPLAY_ORDERS_QUERY_KEY = ['display', 'orders'] as const;

export function useDisplayRealtime(screenId: string): void {
  const qc = useQueryClient();

  // Per-mount UUID — guarantees no channel-name collision under StrictMode.
  // The empty dep array is intentional : we want one UUID per *mount*, not
  // per render. screenId changes don't need a new UUID — the screenId is
  // already embedded in the channel name.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mountId = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    const channelName = `display-${screenId}-${mountId}`;
    const channel = supabase
      .channel(channelName)
      .on(
        // The Supabase JS typings are strict about the 'postgres_changes'
        // literal generic ; cast through `never` to bypass without `any`.
        'postgres_changes' as never,
        {
          event: '*',
          schema: 'public',
          table: 'orders',
        } as never,
        () => {
          void qc.invalidateQueries({ queryKey: DISPLAY_ORDERS_QUERY_KEY });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [screenId, mountId, qc]);
}
