import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Json } from '@breakery/supabase';
import { supabase } from '@/lib/supabase';

export interface HoldOrderArgs {
  cartPayload: { order_type: string; customerId: string | null; items: unknown[] };
  tableNumber: string | null;
  notes: string | null;
}

/**
 * Session 35 (F-003) — DB-backed "hold order" mutation. Persists the current
 * cart as a held draft via `hold_order_v1` (gate `pos.sale.create`, idempotent
 * on `p_client_uuid`). A fresh UUID is minted per call — each user-initiated
 * hold is a distinct order, so we don't pin the key in a useRef.
 */
export function useHoldOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ cartPayload, tableNumber, notes }: HoldOrderArgs) => {
      // Build args conditionally — `exactOptionalPropertyTypes` rejects an
      // explicit `undefined` on optional RPC params, so omit the key instead.
      const args: {
        p_client_uuid: string;
        p_cart_payload: Json;
        p_table_number?: string;
        p_notes?: string;
      } = {
        p_client_uuid: crypto.randomUUID(),
        p_cart_payload: cartPayload as unknown as Json,
      };
      if (tableNumber !== null) args.p_table_number = tableNumber;
      if (notes !== null) args.p_notes = notes;

      const { data, error } = await supabase.rpc('hold_order_v1', args);
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['held-orders'] });
    },
  });
}
