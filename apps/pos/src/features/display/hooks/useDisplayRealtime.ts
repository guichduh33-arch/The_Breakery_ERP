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
//
// Session 59 (16 D1.2) — a second `.on()` listener on the SAME channel now
// also watches `order_items` (unfiltered — a kitchen_status transition can
// move an order both into AND out of 'ready', so a `kitchen_status=eq.ready`
// server-side filter would miss the "leaves ready" case) and invalidates
// `READY_ORDERS_QUERY_KEY`, feeding the "Ready for pickup" ticker section
// (`useReadyOrders`). One channel, two subscriptions — still one unique
// name per mount.

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { useReconnectInvalidate } from '@/lib/useReconnectInvalidate';

export const DISPLAY_ORDERS_QUERY_KEY = ['display', 'orders'] as const;
export const READY_ORDERS_QUERY_KEY = ['display', 'ready-orders'] as const;

export function useDisplayRealtime(screenId: string): void {
  const qc = useQueryClient();

  // LOT 5 — recover a missed event on reconnect (this hook holds no query of
  // its own, so it can't rely on a refetchInterval).
  useReconnectInvalidate([DISPLAY_ORDERS_QUERY_KEY, READY_ORDERS_QUERY_KEY]);

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
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_items' },
        () => {
          void qc.invalidateQueries({ queryKey: READY_ORDERS_QUERY_KEY });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [screenId, qc]);
}
