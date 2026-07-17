// apps/backoffice/src/features/orders/hooks/useUpdateOrderItemQty.ts
// Session 33 / Wave 2.6 — call update_order_item_qty RPC.
// ADR-010 D1/D3/D4 — v2 : une ligne verrouillée (envoyée en cuisine) ne peut
// que BAISSER, sous autorisation manager (nonce single-use scope
// 'order_item_edit' émis par verify-manager-pin, transporté en p_auth_id) avec
// perte obligatoire sur le delta (p_waste_reason ; p_waste_qty défaut = delta).
// Ligne libre : comportement v1 inchangé, les args ADR-010 sont omis.
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

interface Args {
  orderItemId: string;
  qty: number;
  idempotencyKey: string;
  /** ADR-010 D3 — authorization nonce id (locked lines only). */
  authId?: string;
  /** ADR-010 D4 — waste reason, required by the RPC on locked lines. */
  wasteReason?: string;
  /** ADR-010 D4 — waste qty override (0..delta); RPC defaults to the delta. */
  wasteQty?: number;
}
interface Response { order_totals: { subtotal: number; tax_amount: number; total: number }; }

export function useUpdateOrderItemQty() {
  return useMutation<Response, Error, Args>({
    mutationFn: async (args) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('update_order_item_qty_v2', {
        p_order_item_id:   args.orderItemId,
        p_qty:             args.qty,
        p_idempotency_key: args.idempotencyKey,
        ...(args.authId !== undefined ? { p_auth_id: args.authId } : {}),
        ...(args.wasteQty !== undefined ? { p_waste_qty: args.wasteQty } : {}),
        ...(args.wasteReason !== undefined ? { p_waste_reason: args.wasteReason } : {}),
      });
      if (error) throw error;
      return data as Response;
    },
  });
}
