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
// second invocation's .on() runs against the still-subscribed channel from
// the first invocation (`removeChannel` is async). Generating a fresh UUID
// **inside** the effect — not via `useMemo` at render time — guarantees
// each invocation owns a distinct channel identifier, even though the
// component renders only once.

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';

export const DISPLAY_ORDERS_QUERY_KEY = ['display', 'orders'] as const;

export function useDisplayRealtime(screenId: string): void {
  const qc = useQueryClient();

  useEffect(() => {
    const channelName = `display-${screenId}-${crypto.randomUUID()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => {
          void qc.invalidateQueries({ queryKey: DISPLAY_ORDERS_QUERY_KEY });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [screenId, qc]);
}
