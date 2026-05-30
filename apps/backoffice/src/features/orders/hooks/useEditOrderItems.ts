// apps/backoffice/src/features/orders/hooks/useEditOrderItems.ts
// Session 33 / Wave 2.7 — orchestrate the 3 edit-item RPCs sequentially.
// Sequence: removes first, then updates, then adds. Each call has its own
// idempotency key. Errors abort (no rollback cross-RPC — each is atomic
// DB-side). Returns onProgress for UI progress bar.

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

  return useMutation<void, Error, ApplyArgs>({
    mutationFn: async ({ orderId, diff }) => {
      const total = diff.removes.length + diff.updates.length + diff.adds.length;
      let idx = 0;

      for (const orderItemId of diff.removes) {
        opts?.onProgress?.({ step: 'removes', index: idx++, total });
        await remM.mutateAsync({ orderItemId, idempotencyKey: crypto.randomUUID() });
      }

      for (const u of diff.updates) {
        opts?.onProgress?.({ step: 'updates', index: idx++, total });
        await updM.mutateAsync({ orderItemId: u.order_item_id, qty: u.qty, idempotencyKey: crypto.randomUUID() });
      }

      for (const a of diff.adds) {
        opts?.onProgress?.({ step: 'adds', index: idx++, total });
        await addM.mutateAsync({
          orderId,
          productId:      a.product_id,
          qty:            a.qty,
          idempotencyKey: crypto.randomUUID(),
          ...(a.modifiers ? { modifiers: [a.modifiers] } : {}),
        });
      }

      opts?.onProgress?.({ step: 'done', index: total, total });
    },
    onSuccess: (_, { orderId }) => {
      void qc.invalidateQueries({ queryKey: ['orders', 'list'] });
      void qc.invalidateQueries({ queryKey: ['orders', 'detail', orderId] });
    },
  });
}
