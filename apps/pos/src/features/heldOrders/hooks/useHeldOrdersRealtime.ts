import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Session 35 (F-003) — subscribe to `orders` changes and invalidate the
 * held-orders query so the inbox stays live across terminals. The channel name
 * carries a fresh UUID minted INSIDE the effect so StrictMode's double-mount
 * doesn't collide on a shared channel name (project Critical pattern).
 */
export function useHeldOrdersRealtime(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const channelName = `held-orders-${crypto.randomUUID()}`;
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes' as never, { event: '*', schema: 'public', table: 'orders' }, () => {
        void qc.invalidateQueries({ queryKey: ['held-orders'] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
}
