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
    return 'Cette catégorie contient encore des produits — réassignez ou supprimez-les d\'abord.';
  }
  if (message.includes('category_not_found')) {
    return 'Catégorie introuvable.';
  }
  if (message.includes('permission_denied')) {
    return 'Vous n\'avez pas la permission de supprimer une catégorie.';
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
        throw new Error('La catégorie n\'a pas pu être supprimée. Veuillez réessayer.');
      }
      return result;
    },
    onSuccess: async () => {
      idempotencyKeyRef.current = crypto.randomUUID();
      await qc.invalidateQueries({ queryKey: CATEGORIES_ALL_KEY });
    },
  });
}
