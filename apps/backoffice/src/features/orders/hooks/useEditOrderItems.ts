// apps/backoffice/src/features/orders/hooks/useEditOrderItems.ts
// Session 33 / Wave 2.7 — orchestrate the 3 edit-item RPCs sequentially.
// Sequence: removes first, then updates, then adds. Each call has its own
// idempotency key. Errors abort (no rollback cross-RPC — each is atomic
// DB-side). Returns onProgress for UI progress bar.

import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAddOrderItem } from './useAddOrderItem';
import { useUpdateOrderItemQty } from './useUpdateOrderItemQty';
import { useRemoveOrderItem } from './useRemoveOrderItem';
import type { OrderEditDiff } from '../types';

interface ApplyArgs {
  orderId: string;
  diff:    OrderEditDiff;
}

interface ApplyProgress {
  step:  'removes' | 'updates' | 'adds' | 'done';
  index: number;
  total: number;
}

export function useEditOrderItems(opts?: { onProgress?: (p: ApplyProgress) => void }) {
  const qc = useQueryClient();
  const addM = useAddOrderItem();
  const updM = useUpdateOrderItemQty();
  const remM = useRemoveOrderItem();

  // Stable per-operation idempotency keys, held across retries. A retried "Apply"
  // of the SAME diff reuses the same keys, so already-applied ops replay server-side
  // (order_edit_idempotency_keys) instead of double-applying. Cleared on success.
  const keyMap = useRef<Map<string, string>>(new Map());
  function keyFor(op: string): string {
    const existing = keyMap.current.get(op);
    if (existing !== undefined) return existing;
    const k = crypto.randomUUID();
    keyMap.current.set(op, k);
    return k;
  }

  return useMutation<void, Error, ApplyArgs>({
    mutationFn: async ({ orderId, diff }) => {
      const total = diff.removes.length + diff.updates.length + diff.adds.length;
      let idx = 0;

      for (const orderItemId of diff.removes) {
        opts?.onProgress?.({ step: 'removes', index: idx++, total });
        await remM.mutateAsync({ orderItemId, idempotencyKey: keyFor(`remove:${orderItemId}`) });
      }

      for (const u of diff.updates) {
        opts?.onProgress?.({ step: 'updates', index: idx++, total });
        await updM.mutateAsync({ orderItemId: u.order_item_id, qty: u.qty, idempotencyKey: keyFor(`update:${u.order_item_id}:${u.qty}`) });
      }

      for (const [addIdx, a] of diff.adds.entries()) {
        opts?.onProgress?.({ step: 'adds', index: idx++, total });
        await addM.mutateAsync({
          orderId,
          productId:      a.product_id,
          qty:            a.qty,
          idempotencyKey: keyFor(`add:${addIdx}:${a.product_id}:${a.qty}`),
          ...(a.modifiers ? { modifiers: [a.modifiers] } : {}),
        });
      }

      opts?.onProgress?.({ step: 'done', index: total, total });
    },
    onSuccess: (_, { orderId }) => {
      keyMap.current.clear();
      void qc.invalidateQueries({ queryKey: ['orders', 'list'] });
      void qc.invalidateQueries({ queryKey: ['order-detail', orderId] });
    },
  });
}
