import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

export function useTabletOrderStatusListener() {
  const userId = useAuthStore((s) => s.user?.id);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel('tablet-order-status')
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
  }, [userId, queryClient]);
}
