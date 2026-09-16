import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { B2B_INVOICES_QUERY_KEY } from './useB2bInvoices.js';

export function useUpdateB2bPickup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { orderId: string; pickupDate?: string; delivered: boolean }) => {
      const { data, error } = await supabase.rpc('update_b2b_pickup_v1', {
        p_order_id: args.orderId,
        ...(args.pickupDate ? { p_pickup_date: args.pickupDate } : {}),
        p_mark_delivered: args.delivered,
      });
      if (error) throw new Error(error.message);
      if (data === null) throw new Error('Empty pickup response');
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: B2B_INVOICES_QUERY_KEY });
    },
  });
}
