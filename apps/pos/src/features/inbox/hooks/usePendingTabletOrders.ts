import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { TabletOrderEntry } from '@breakery/domain';

interface RawOrderItem {
  id: string;
  unit_price: number;
  quantity: number;
}

interface RawProfile {
  full_name?: string;
}

export function usePendingTabletOrders() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channelName = `pending-tablet-orders-${crypto.randomUUID()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `created_via=eq.tablet`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['pending-tablet-orders'] });
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [queryClient]);

  return useQuery({
    queryKey: ['pending-tablet-orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id,
          order_number,
          table_number,
          order_type,
          waiter_id,
          sent_to_kitchen_at,
          order_items(id, unit_price, quantity),
          user_profiles!waiter_id(full_name)
        `)
        .eq('created_via', 'tablet')
        .eq('status', 'pending_payment')
        .order('sent_to_kitchen_at', { ascending: false });
      if (error) throw new Error(error.message);

      return (data ?? []).map((row) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const rawProfile = Array.isArray(row.user_profiles)
          ? row.user_profiles[0]
          : row.user_profiles;
        const profile = rawProfile as RawProfile | null | undefined;
        const orderItems = (row.order_items as unknown as RawOrderItem[]) ?? [];
        const items_total = orderItems.reduce(
          (sum, i) => sum + i.unit_price * i.quantity,
          0,
        );
        return {
          id: row.id,
          order_number: row.order_number,
          table_number: row.table_number,
          order_type: row.order_type as 'dine_in' | 'take_out',
          waiter_id: row.waiter_id!,
          waiter_name: profile?.full_name ?? 'Waiter',
          sent_to_kitchen_at: row.sent_to_kitchen_at!,
          items_count: orderItems.length,
          items_total,
        } satisfies TabletOrderEntry;
      });
    },
  });
}
