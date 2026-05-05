import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useCancelTabletOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase.rpc('cancel_tablet_order', { p_order_id: orderId });
      if (error) throw Object.assign(new Error(error.message), { details: error });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tablet-orders'] });
    },
  });
}
