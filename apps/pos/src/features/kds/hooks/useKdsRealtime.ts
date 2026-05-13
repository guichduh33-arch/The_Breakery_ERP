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

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { KdsStation } from '@/stores/kdsStore';

export function useKdsRealtime(station: KdsStation): void {
  const qc = useQueryClient();

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
