// apps/backoffice/src/features/categories/hooks/useDeleteCategory.ts
//
// Wraps delete_category_v1 (soft-delete). Pattern mirrors useDeleteProduct (S45):
// bound supabase.rpc, idempotency key held in a ref (rotates on success), and a
// defensive guard on deleted === true.

import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { CATEGORIES_ALL_KEY } from './useAllCategories.js';

export interface DeleteCategoryArgs {
  categoryId: string;
}

export interface DeleteCategoryResult {
  category_id:       string;
  deleted:           boolean;
  idempotent_replay: boolean;
}

function mapDeleteError(message: string): string {
  if (message.includes('category_has_products')) {
    return 'This category still holds products — reassign or delete them first.';
  }
  if (message.includes('category_not_found')) {
    return 'Category not found.';
  }
  if (message.includes('permission_denied')) {
    return 'You do not have permission to delete a category.';
  }
  return message;
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  const idempotencyKeyRef = useRef(crypto.randomUUID());

  return useMutation<DeleteCategoryResult, Error, DeleteCategoryArgs>({
    mutationFn: async ({ categoryId }) => {
      const rpc = supabase.rpc.bind(supabase);
      const { data, error } = await rpc('delete_category_v1', {
        p_category_id:     categoryId,
        p_idempotency_key: idempotencyKeyRef.current,
      });
      if (error !== null) throw new Error(mapDeleteError(error.message));
      const result = data as unknown as DeleteCategoryResult;
      if (result.deleted !== true) {
        throw new Error('The category could not be deleted. Please try again.');
      }
      return result;
    },
    onSuccess: async () => {
      idempotencyKeyRef.current = crypto.randomUUID();
      await qc.invalidateQueries({ queryKey: CATEGORIES_ALL_KEY });
      // ADR-011 §3 — product-side dropdowns cache under their own key
      // (5 min staleTime) ; sans cette invalidation ils continuent de
      // proposer la catégorie supprimée.
      await qc.invalidateQueries({ queryKey: ['products', 'categories'] });
    },
  });
}
