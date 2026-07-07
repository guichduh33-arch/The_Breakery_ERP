// apps/pos/src/features/kds/hooks/useKdsRealtime.ts
//
// Session 2 — subscribe to postgres_changes on `order_items`, scoped to the
// dispatch station currently displayed. Each event invalidates the matching
// TanStack query so the KDS view refreshes in <1s.
//
// Cleanup is mandatory: removing the channel on unmount/station change
// prevents the V2-era leak documented in session 1.
//
// Session 13 / Phase 4.B — extended to also surface `bumped_at` and
// `prep_started_at` column updates. The `event: '*'` filter already
// captures every UPDATE on order_items so no payload-level changes are
// needed ; we just refresh the kds query as before. Preserves D19
// per-effect-mount unique-channel pattern.
//
// Session 13 / Phase 5.A — optionally broadcasts each bump event on the
// LAN mesh so peer devices (POS, customer display, tablet) can react
// without waiting on their own DB subscription. Accepts an `onBump`
// callback ; production callers wire it to `useLanClient.send`.
//
// Session 59 review (finding 1) — also invalidates ['kds-served', station]
// so a served/recalled item's move into or out of the recall strip reflects
// in realtime rather than waiting on that query's 30s refetchInterval.
//
// D19 — Channel-name uniqueness pattern (Wave 1 hotfix). Under StrictMode,
// React double-invokes effects in dev ; with a static channel name the
// second mount's `.on()` runs against the still-subscribed channel from
// the first mount (`removeChannel` is async). Each effect mount generates
// its own `crypto.randomUUID()` suffix → 2 distinct channel names under
// StrictMode (verified by `useKdsRealtime.uniqueChannel.test.tsx`).
//
// IMPORTANT : we generate the UUID INSIDE the effect, NOT via a
// component-body `useMemo`. In StrictMode the useMemo from the first
// render is discarded and the second-render UUID is reused across both
// effect mounts → channel-name collision. The effect body, by contrast,
// runs once per effect cycle, so each mount produces its own UUID.

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { KdsStation } from '@/stores/kdsStore';

interface UseKdsRealtimeOptions {
  /** Optional callback invoked on every order_items event. The KDS
   *  hooks the LAN client here so peer devices (Phase 5.A) can react
   *  to bumps in real time without their own DB subscription. */
  onEvent?: (payload: unknown) => void;
  /** Design Wave C — reports channel connection health so the board can show a
   *  "Reconnecting…" banner. `true` once the channel is SUBSCRIBED, `false` on
   *  CHANNEL_ERROR / TIMED_OUT / CLOSED. Read through a ref so passing an inline
   *  callback never re-arms the subscription (channel-name uniqueness intact). */
  onConnectionChange?: (connected: boolean) => void;
}

export function useKdsRealtime(
  station: KdsStation,
  opts: UseKdsRealtimeOptions = {},
): void {
  const qc = useQueryClient();
  const { onEvent, onConnectionChange } = opts;

  // Keep the connection callback in a ref so it is NOT part of the effect deps
  // (which would restart the subscription and churn channel names).
  const onConnectionChangeRef = useRef(onConnectionChange);
  onConnectionChangeRef.current = onConnectionChange;

  useEffect(() => {
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
        (payload: unknown) => {
          void qc.invalidateQueries({ queryKey: ['kds', station] });
          void qc.invalidateQueries({ queryKey: ['kds-served', station] });
          if (onEvent !== undefined) onEvent(payload);
        },
      )
      .subscribe((status: string) => {
        // 'SUBSCRIBED' means the realtime socket is live; anything else
        // (CHANNEL_ERROR, TIMED_OUT, CLOSED) means events may be dropping.
        onConnectionChangeRef.current?.(status === 'SUBSCRIBED');
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [station, qc, onEvent]);
}
