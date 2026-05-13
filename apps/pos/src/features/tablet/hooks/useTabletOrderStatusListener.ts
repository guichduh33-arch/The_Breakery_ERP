import { useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

export function useTabletOrderStatusListener() {
  const userId = useAuthStore((s) => s.user?.id);
  const queryClient = useQueryClient();
  // StrictMode double-invokes effects in dev; a static channel name would
  // collide with the still-subscribed channel from the first mount
  // (removeChannel is async). Suffix with a per-mount UUID.
  // Pattern ref: apps/pos/src/features/kds/hooks/useKdsRealtime.ts (C2 fix).
  const mountId = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`tablet-order-status-${mountId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'order_items',
          filter: `kitchen_status=eq.ready`,
        },
        (payload) => {
          const item = payload.new as { order_id?: string; name?: string };
          toast.success(`Item ready: ${item.name ?? 'item'}`);
          void queryClient.invalidateQueries({ queryKey: ['tablet-orders', userId] });
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [userId, queryClient, mountId]);
}
