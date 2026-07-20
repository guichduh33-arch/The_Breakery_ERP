// apps/pos/src/features/kds/hooks/useKdsStartPrepTimer.ts
//
// Session 13 / Phase 4.B — RPC mutation wrapping `kds_start_prep_timer_v1`.
// Auto-called when a cashier transitions an item from pending → preparing.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { tryLocalItemStatus } from '../offlineItemStatus';

interface RpcError {
  code?: string;
  message: string;
}

interface RpcResult {
  data: unknown;
  error: RpcError | null;
}

interface LooseSupabase {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
}

const sb = supabase as unknown as LooseSupabase;

export function useKdsStartPrepTimer() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (orderItemId: string) => {
      // Spec 006x lot 3 — ligne locale (bus LAN) : statut local, pas de RPC.
      if (tryLocalItemStatus(orderItemId, 'preparing')) return;
      const { error } = await sb.rpc('kds_start_prep_timer_v1', {
        p_order_item_id: orderItemId,
      });
      if (error) {
        const err = Object.assign(new Error(error.message), { code: error.code });
        throw err;
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['kds'] });
    },
  });
}
