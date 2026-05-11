// apps/pos/src/features/kds/hooks/useKdsRealtime.ts
//
// Session 2 — subscribe to postgres_changes on `order_items`, scoped to the
// dispatch station currently displayed. Each event invalidates the matching
// TanStack query so the KDS view refreshes in <1s.
//
// Cleanup is mandatory: removing the channel on unmount/station change
// prevents the V2-era leak documented in session 1.

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { KdsStation } from '@/stores/kdsStore';

export function useKdsRealtime(station: KdsStation): void {
  const qc = useQueryClient();

  useEffect(() => {
    // StrictMode double-invokes effects in dev; with a static channel name the
    // second mount's .on() runs against the still-subscribed channel from the
    // first mount (removeChannel is async). Suffix with a per-mount UUID.
    const channelName = `kds-${station}-${crypto.randomUUID()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        // The Supabase JS typings are strict about the literal 'postgres_changes'
        // generic; cast through a typed helper instead of `any`.
        'postgres_changes' as never,
        {
          event: '*',
          schema: 'public',
          table: 'order_items',
          filter: `dispatch_station=eq.${station}`,
        } as never,
        () => {
          void qc.invalidateQueries({ queryKey: ['kds', station] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [station, qc]);
}
