// apps/backoffice/src/features/products/hooks/useDeleteProduct.ts
//
// Session 45 — Wave B — Wraps `delete_product_v1` (soft-delete).
//
// RPC success shape: { product_id, deleted: true, idempotent_replay: false|true }
// RPC errors:
//   42501 — permission denied (caught by PermissionGate before we get here, but handle anyway)
//   P0001 message 'parent_has_active_variants' — user-friendly message surfaced to the UI
//   P0002 message 'product_not_found'
//
// Idempotency: useRef(crypto.randomUUID()) — stable across re-renders, reset on success.
// Pattern: supabase.rpc bound (critical S27 lesson: unbound RPC throws at runtime).

import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface DeleteProductArgs {
  productId: string;
}

export interface DeleteProductResult {
  product_id:        string;
  deleted:           boolean;
  idempotent_replay: boolean;
}

/** Map a raw Postgres/RPC error message to a user-friendly string. */
function mapDeleteError(message: string): string {
  if (message.includes('parent_has_active_variants')) {
    return 'Ce produit est un parent de variantes actives — dissolvez ou désactivez les variantes d\'abord.';
  }
  if (message.includes('product_not_found')) {
    return 'Produit introuvable.';
  }
  return message;
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  // Stable idempotency key across re-renders; reset on success.
  const idempotencyKeyRef = useRef(crypto.randomUUID());

  const mutation = useMutation<DeleteProductResult, Error, DeleteProductArgs>({
    mutationFn: async ({ productId }) => {
      // Bind supabase.rpc to supabase — critical: unbound call throws at runtime.
      const rpc = supabase.rpc.bind(supabase);
      const { data, error } = await rpc('delete_product_v1', {
        p_product_id:       productId,
        p_idempotency_key: idempotencyKeyRef.current,
      });
      if (error !== null) throw new Error(mapDeleteError(error.message));
      return data as unknown as DeleteProductResult;
    },
    onSuccess: async () => {
      // Reset idempotency key for the next deletion.
      idempotencyKeyRef.current = crypto.randomUUID();
      // Invalidate the products catalog list — exact key from useProducts.
      await qc.invalidateQueries({ queryKey: ['products', 'catalog'] });
    },
    onError: (error) => {
      // Error is surfaced by the dialog component; no extra side-effect here.
      void error;
    },
  });

  return mutation;
}
