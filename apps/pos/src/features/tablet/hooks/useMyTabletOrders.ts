import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

interface TabletOrderItemRow {
  id: string;
  name: string;
  quantity: number;
  kitchen_status: string;
}

export interface TabletOrderRow {
  id: string;
  order_number: string;
  table_number: string | null;
  order_type: 'dine_in' | 'take_out';
  status: string;
  sent_to_kitchen_at: string;
  items: TabletOrderItemRow[];
}

export function useMyTabletOrders() {
  const userId = useAuthStore((s) => s.user?.id);

  return useQuery({
    queryKey: ['tablet-orders', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, table_number, order_type, status, sent_to_kitchen_at, order_items(id, name, quantity, kitchen_status)')
        .eq('waiter_id', userId!)
        .eq('created_via', 'tablet')
        .order('sent_to_kitchen_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => ({
        id: row.id,
        order_number: row.order_number,
        table_number: row.table_number,
        order_type: row.order_type as 'dine_in' | 'take_out',
        status: row.status,
        sent_to_kitchen_at: row.sent_to_kitchen_at ?? new Date().toISOString(),
        items: (row.order_items as unknown as TabletOrderItemRow[]) ?? [],
      }));
    },
  });
}
