// apps/backoffice/src/features/categories/hooks/useCategoryMutations.ts
// Session 27b — Wraps create_category_v1, update_category_v1, reorder_categories_v1.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface CreateCategoryPayload {
  name:              string;
  slug?:             string;
  is_active?:        boolean;
  dispatch_station?: string;
  kds_station?:      string;
  show_in_pos?:      boolean;
  is_raw_material?:  boolean;
}

export interface UpdateCategoryPatch {
  name?:             string;
  slug?:             string;
  sort_order?:       number;
  is_active?:        boolean;
  dispatch_station?: string;
  kds_station?:      string;
  show_in_pos?:      boolean;
  is_raw_material?:  boolean;
}

const CATEGORIES_KEY = ['categories', 'all'] as const;

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, CreateCategoryPayload>({
    mutationFn: async (payload) => {
      const { data, error } = await supabase.rpc('create_category_v1', {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        p_payload: payload as any,
      });
      if (error !== null) throw new Error(error.message);
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: CATEGORIES_KEY });
    },
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { categoryId: string; patch: UpdateCategoryPatch }>({
    mutationFn: async ({ categoryId, patch }) => {
      const { data, error } = await supabase.rpc('update_category_v1', {
        p_category_id: categoryId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        p_patch:       patch as any,
      });
      if (error !== null) throw new Error(error.message);
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: CATEGORIES_KEY });
    },
  });
}

export function useReorderCategories() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, string[]>({
    mutationFn: async (orderedIds) => {
      const { data, error } = await supabase.rpc('reorder_categories_v1', {
        p_ordered_ids: orderedIds,
      });
      if (error !== null) throw new Error(error.message);
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: CATEGORIES_KEY });
    },
  });
}
