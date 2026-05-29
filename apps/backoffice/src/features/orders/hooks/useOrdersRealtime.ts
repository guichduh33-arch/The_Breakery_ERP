// apps/backoffice/src/features/orders/hooks/useOrdersRealtime.ts
// Session 33 / Wave 2.4 — Realtime subscription on public.orders.
// StrictMode-safe via unique channel name per mount (CLAUDE.md critical
// pattern: "Realtime channel names must be unique per mount").
// On INSERT or UPDATE events, invalidates the React Query cache for the
// orders list (refetch is simpler than merge-in-place — acceptable at
// <500 orders/day; merge-in-place can be a future S34+ optimization).

import { useEffect, useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export function useOrdersRealtime() {
  const queryClient = useQueryClient();
  const id = useId();
  const [isConnected, setConnected] = useState(false);

  useEffect(() => {
    const channelName = `orders-list-${id}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        () => queryClient.invalidateQueries({ queryKey: ['orders', 'list'] }),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders' },
        () => queryClient.invalidateQueries({ queryKey: ['orders', 'list'] }),
      )
      .subscribe((status) => setConnected(status === 'SUBSCRIBED'));

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id, queryClient]);

  return { isConnected };
}
