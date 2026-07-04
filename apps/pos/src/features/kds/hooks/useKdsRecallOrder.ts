// apps/pos/src/features/kds/hooks/useKdsRecallOrder.ts
//
// Session 13 / Phase 4.B — RPC mutation wrapping `kds_recall_order_v1`.
// Returns the integer count of items recalled (served → preparing).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

interface RpcError {
  code?: string;
  message: string;
}

interface RpcResult<T = unknown> {
  data: T;
  error: RpcError | null;
}

interface LooseSupabase {
  rpc: <T = unknown>(fn: string, args: Record<string, unknown>) => Promise<RpcResult<T>>;
}

const sb = supabase as unknown as LooseSupabase;

export interface KdsRecallOrderInput {
  orderId: string;
  reason?: string | undefined;
}

export function useKdsRecallOrder() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ orderId, reason }: KdsRecallOrderInput) => {
      const { data, error } = await sb.rpc<number>('kds_recall_order_v1', {
        p_order_id: orderId,
        p_reason:   reason ?? null,
      });
      if (error) {
        const err = Object.assign(new Error(error.message), { code: error.code });
        throw err;
      }
      return (data ?? 0);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['kds'] });
      // Session 59 review (finding 1) — a recall moves items served→preparing,
      // which should drop the order from the "Recently served" strip
      // (['kds-served', station]) immediately rather than up to 30s later.
      void qc.invalidateQueries({ queryKey: ['kds-served'] });
    },
  });
}
