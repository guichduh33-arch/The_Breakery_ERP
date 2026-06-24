// apps/pos/src/features/promotions/hooks/usePromotionsRealtime.ts
//
// Session 9 — subscribe to Postgres realtime on `public.promotions` and
// invalidate the active-promotions react-query cache on any change.
//
// Spec ref: 2026-05-10-session-9-promotions-spec.md §7 risk row "Realtime
// cache invalidation". supabase-js re-subscribes automatically on reconnect.
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useReconnectInvalidate } from '@/lib/useReconnectInvalidate';
import { PROMOTIONS_QUERY_KEY } from './usePromotions';

export function usePromotionsRealtime(): void {
  const qc = useQueryClient();

  // LOT 5 — reconnect safety net for this realtime-only hook.
  useReconnectInvalidate([PROMOTIONS_QUERY_KEY]);

  useEffect(() => {
    // StrictMode double-invokes effects in dev; a static channel name would
    // collide with the still-subscribed channel from the first mount
    // (removeChannel is async). We generate the UUID INSIDE the effect, NOT
    // via a component-body `useMemo` — the memo from the first render is
    // discarded in StrictMode and the second-render UUID would be reused
    // across both effect mounts. Pattern ref: useKdsRealtime.ts.
    const channelName = `promotions-changes-${crypto.randomUUID()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        // Strict supabase-js literal typing — same `as never` cast as
        // useKdsRealtime to avoid `any`.
        'postgres_changes' as never,
        {
          event: '*',
          schema: 'public',
          table: 'promotions',
        } as never,
        () => {
          void qc.invalidateQueries({ queryKey: PROMOTIONS_QUERY_KEY });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
}
