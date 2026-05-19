import { useMutation, useQueryClient } from '@tanstack/react-query';
import { buildSubmitPayload } from '@breakery/domain';
import type { TabletCart } from '@breakery/domain';
import type { Json } from '@breakery/supabase';
import { supabase } from '@/lib/supabase';

interface CreateTabletOrderArgs {
  cart: TabletCart;
  waiterId: string;
  clientUuid: string;
}

export function useCreateTabletOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ cart, waiterId, clientUuid }: CreateTabletOrderArgs) => {
      const payload = buildSubmitPayload(cart, waiterId);
      const { data, error } = await supabase.rpc('create_tablet_order_v2', {
        p_client_uuid: clientUuid,
        p_waiter_id: payload.p_waiter_id,
        p_table_number: payload.p_table_number ?? '',
        p_order_type: payload.p_order_type,
        p_items: payload.p_items as unknown as Json,
      });
      if (error) throw Object.assign(new Error(error.message), { details: error });
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tablet-orders'] });
    },
  });
}
