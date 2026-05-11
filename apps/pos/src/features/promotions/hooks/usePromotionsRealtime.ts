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
import { PROMOTIONS_QUERY_KEY } from './usePromotions';

export function usePromotionsRealtime(): void {
  const qc = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel('promotions-changes')
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
