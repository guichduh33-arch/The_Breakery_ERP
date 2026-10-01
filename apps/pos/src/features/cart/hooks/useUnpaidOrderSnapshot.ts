import { useQuery } from '@tanstack/react-query';
import type { Database } from '@breakery/supabase';
import { supabase } from '@/lib/supabase';

export type CancelLine = Database['public']['Tables']['order_items']['Row'];
export interface UnpaidOrderSnapshot {
  id: string;
  updated_at: string;
  status: string;
  created_via: string;
  order_number: string;
  order_items: CancelLine[];
}
export function useUnpaidOrderSnapshot(orderId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['cancel-unpaid-snapshot', orderId],
    enabled: enabled && orderId !== null,
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<UnpaidOrderSnapshot> => {
      if (!orderId) throw new Error('Order required');
      // Les lignes complètes servent de précondition atomique ; aucun prix local ne fait foi.
      const { data, error } = await supabase.from('orders')
        .select('id, updated_at, status, created_via, order_number, order_items(*)')
        .eq('id', orderId).single();
      if (error) throw error;
      if (!data.updated_at || !['draft', 'pending_payment'].includes(data.status)
        || !['pos', 'tablet'].includes(data.created_via) || !data.order_items.length) {
        throw new Error('Only an unpaid counter or tablet order can be cancelled here');
      }
      return data;
    },
  });
}
