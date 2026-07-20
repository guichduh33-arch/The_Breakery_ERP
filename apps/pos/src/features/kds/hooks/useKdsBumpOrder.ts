// apps/pos/src/features/kds/hooks/useKdsBumpOrder.ts
//
// Session 60 (04 D1.2) — RPC mutation wrapping `kds_bump_order_v1`.
// Mints a per-call UUID idempotency key so retries are safe. Copied from
// useKdsBumpItem.ts, scoped to a whole order instead of a single item.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { emitPosEvent } from '@/features/audit/emitPosEvent';
import { tryLocalOrderStatus } from '../offlineItemStatus';

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

export interface KdsBumpOrderInput {
  orderId: string;
  /** Optional override — otherwise a fresh UUID is minted. */
  idempotencyKey?: string;
}

export function useKdsBumpOrder() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ orderId, idempotencyKey }: KdsBumpOrderInput) => {
      const key = idempotencyKey ?? crypto.randomUUID();
      // Spec 006x lot 3 — ordre local (fired via le bus) : toutes ses lignes
      // actives passent ready localement + sur le bus, pas de RPC.
      const localCount = tryLocalOrderStatus(orderId, 'ready');
      if (localCount !== null) {
        return { bumpedCount: localCount, idempotencyKey: key };
      }
      const { data, error } = await sb.rpc('kds_bump_order_v1', {
        p_order_id:        orderId,
        p_idempotency_key: key,
      });
      if (error) {
        const err = Object.assign(new Error(error.message), { code: error.code });
        throw err;
      }
      // S72 audit — kitchen marked the order ready/served (bumped off the KDS).
      emitPosEvent('kitchen_bumped', {
        order_id: orderId,
        payload: { bumped_count: data ?? 0 },
      });
      return { bumpedCount: (data as number) ?? 0, idempotencyKey: key };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['kds'] });
    },
  });
}
