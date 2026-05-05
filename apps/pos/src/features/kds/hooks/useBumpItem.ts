// apps/pos/src/features/kds/hooks/useBumpItem.ts
//
// Session 2 — mutation that advances an order item along the kitchen flow:
//   pending → preparing  (Start)
//   preparing → ready    (Bump Ready)
//
// Transitions are guarded by `canTransition()` from the kitchen domain
// (currently mirrored in `@/types/kitchen` until the Modifiers agent merges).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { canTransition, type KitchenStatus } from '@breakery/domain';

import { supabase } from '@/lib/supabase';

// See useKdsOrders for context: kitchen_status / ready_at / is_locked are not
// yet in the generated `Database` type. We expose only the narrow surface
// we need via a local builder interface — no @supabase/supabase-js import.
interface UpdateResult {
  error: { message: string } | null;
}
interface UpdateBuilder {
  eq: (col: string, val: unknown) => Promise<UpdateResult>;
}
interface LooseFromBuilder {
  update: (payload: Record<string, unknown>) => UpdateBuilder;
}
interface LooseSupabase {
  from: (table: string) => LooseFromBuilder;
}
const sb = supabase as unknown as LooseSupabase;

export interface BumpItemInput {
  id: string;
  from: KitchenStatus;
  to: KitchenStatus;
}

export function useBumpItem() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, from, to }: BumpItemInput) => {
      if (!canTransition(from, to)) {
        throw new Error(`invalid_transition_${from}_${to}`);
      }

      const updates: Record<string, unknown> = { kitchen_status: to };
      if (to === 'ready') {
        updates.ready_at = new Date().toISOString();
      }

      const { error } = await sb
        .from('order_items')
        .update(updates)
        .eq('id', id);

      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['kds'] });
    },
  });
}
