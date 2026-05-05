// apps/pos/src/features/cart/hooks/useSendToKitchen.ts
//
// Hook that locks the given cart line ids in the cart store, marking them as
// "sent to kitchen". Returns a TanStack Query mutation so callers get
// `isPending`, `isError`, and `mutateAsync` semantics consistent with the rest
// of the codebase.
//
// V1 IMPLEMENTATION NOTE
// ----------------------
// In v1 this hook does NOT yet hit the DB. The agent handling SQL/migrations
// is delivering `send_items_to_kitchen(p_item_ids UUID[])` and the RLS bits,
// but for those ids to exist server-side, order_items must already be persisted.
// Today, items are only INSERTed by `complete_order_with_payment` (at checkout).
// Persisting items earlier (draft order pattern) requires a new RPC
// `create_draft_order_items` — out of scope for this batch.
//
// As a result, in v1 the lock is purely client-side. The KDS agent picks up
// the locked items via a Realtime payload broadcast from cartStore (see KDS
// agent's session-2 implementation). When session 2.1 lands the draft-order
// RPC, swap the body of this mutation for an actual
// `supabase.rpc('send_items_to_kitchen', { p_item_ids })` call.
import { useMutation } from '@tanstack/react-query';
import { useCartStore } from '@/stores/cartStore';

export function useSendToKitchen() {
  return useMutation({
    mutationFn: (lineIds: string[]) => {
      // TODO session 2.1: persist draft order_items + RPC send_items_to_kitchen
      //   const { data, error } = await supabase.rpc('send_items_to_kitchen', {
      //     p_item_ids: lineIds,
      //   });
      //   if (error) throw error;
      //   return data;
      if (lineIds.length === 0) return Promise.resolve([] as string[]);
      useCartStore.getState().markLocked(lineIds);
      return Promise.resolve(lineIds);
    },
  });
}
