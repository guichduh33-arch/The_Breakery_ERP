import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

// Bound the dedupe set so a long-running tablet session can't leak memory
// — 1000 events would be ~36 hours of cooking at one ready/sec, far past
// any realistic single shift.
const DEDUPE_LIMIT = 1000;

export function useTabletOrderStatusListener() {
  const userId = useAuthStore((s) => s.user?.id);
  const queryClient = useQueryClient();

  // Phase 4.D — dedupe ready events. Realtime can replay events on
  // reconnect or deliver them out of order ; the toast must fire at most
  // once per (order_item_id, kitchen_status) transition.
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) return;

    // StrictMode double-invokes effects in dev; a static channel name would
    // collide with the still-subscribed channel from the first mount
    // (removeChannel is async). We generate the UUID INSIDE the effect, NOT
    // via a component-body `useMemo` — the memo from the first render is
    // discarded in StrictMode and the second-render UUID would be reused
    // across both effect mounts. Pattern ref: useKdsRealtime.ts.
    const channelName = `tablet-order-status-${crypto.randomUUID()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'order_items',
          filter: `kitchen_status=eq.ready`,
        },
        (payload) => {
          const item = payload.new as {
            id?:             string;
            order_id?:       string;
            name?:           string;
            kitchen_status?: string;
          };
          const key = `${item.id ?? 'unknown'}:${item.kitchen_status ?? 'ready'}`;

          // Bounded LRU-like behaviour : drop oldest when full.
          const seen = seenRef.current;
          if (seen.has(key)) return;
          if (seen.size >= DEDUPE_LIMIT) {
            const first = seen.values().next().value;
            if (first !== undefined) seen.delete(first);
          }
          seen.add(key);

          toast.success(`Item ready: ${item.name ?? 'item'}`);
          void queryClient.invalidateQueries({ queryKey: ['tablet-orders', userId] });
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [userId, queryClient]);
}
