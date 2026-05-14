// apps/pos/src/features/kds/hooks/useKdsBumpItem.ts
//
// Session 13 / Phase 4.B — RPC mutation wrapping `kds_bump_item_v1`.
// Mints a per-call UUID idempotency key so retries are safe.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

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

export interface KdsBumpItemInput {
  orderItemId: string;
  /** Optional override — otherwise a fresh UUID is minted. */
  idempotencyKey?: string;
}

export function useKdsBumpItem() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ orderItemId, idempotencyKey }: KdsBumpItemInput) => {
      const key = idempotencyKey ?? crypto.randomUUID();
      const { error } = await sb.rpc('kds_bump_item_v1', {
        p_order_item_id:   orderItemId,
        p_idempotency_key: key,
      });
      if (error) {
        const err = Object.assign(new Error(error.message), { code: error.code });
        throw err;
      }
      return { idempotencyKey: key };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['kds'] });
    },
  });
}
