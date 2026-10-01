// apps/pos/src/features/kds/hooks/useKdsBumpOrder.ts
//
// Session 60 (04 D1.2) — RPC mutation wrapping `kds_bump_order_v2`.
// Mints a per-call UUID idempotency key so retries are safe. Copied from
// useKdsBumpItem.ts, scoped to a whole order instead of a single item.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { emitPosEvent } from '@/features/audit/emitPosEvent';
import { tryLocalOrderStatus, localKitchenRow } from '../offlineItemStatus';

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
  itemIds?: string[];
  /** Optional override — otherwise a fresh UUID is minted. */
  idempotencyKey?: string;
}

export function useKdsBumpOrder() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ orderId, itemIds, idempotencyKey }: KdsBumpOrderInput) => {
      const key = idempotencyKey ?? crypto.randomUUID();
      // Spec 006x lot 3 — ordre local (fired via le bus) : toutes ses lignes
      // actives passent ready localement + sur le bus, pas de RPC.
      const localIds = itemIds?.filter((id) => localKitchenRow(id) !== undefined);
      const localRoots = new Set((localIds ?? []).map((id) => localKitchenRow(id)!.order_id));
      // Les IDs visibles classent la carte ; le geste porte sur la commande
      // entière, y compris ses lignes affectées aux autres stations.
      const advanceLocalOrders = () => [...localRoots].reduce(
        (count, root) => count + (tryLocalOrderStatus(root, 'ready') ?? 0), 0,
      );
      if (localIds && localIds.length === itemIds?.length) {
        return { bumpedCount: advanceLocalOrders(), idempotencyKey: key };
      }
      const localCount = itemIds ? null : tryLocalOrderStatus(orderId, 'ready');
      if (localCount !== null) {
        return { bumpedCount: localCount, idempotencyKey: key };
      }
      const { data, error } = await sb.rpc('kds_bump_order_v2', {
        p_order_id:        orderId,
        p_idempotency_key: key,
      });
      if (error) {
        const err = Object.assign(new Error(error.message), { code: error.code });
        throw err;
      }
      // Sur carte mixte, la RPC canonique réussit avant les gestes locaux :
      // une coupure ne peut confirmer uniquement la moitié de « All ready ».
      advanceLocalOrders();
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
