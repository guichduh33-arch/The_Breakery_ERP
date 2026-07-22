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
  category_type?:    'raw_material' | 'semi_finished' | 'finished';
}

export interface UpdateCategoryPatch {
  name?:             string;
  slug?:             string;
  sort_order?:       number;
  is_active?:        boolean;
  dispatch_station?: string;
  kds_station?:      string;
  show_in_pos?:      boolean;
  category_type?:    'raw_material' | 'semi_finished' | 'finished';
}

const CATEGORIES_KEY = ['categories', 'all'] as const;

// ADR-011 §3 — the product-side category dropdowns (features/products
// useCategories) cache under a different key with a 5 min staleTime; without
// this second invalidation they kept serving a renamed/deleted category for
// up to 5 minutes after a mutation here.
const PRODUCTS_CATEGORIES_KEY = ['products', 'categories'] as const;

async function invalidateCategoryCaches(qc: ReturnType<typeof useQueryClient>): Promise<void> {
  await Promise.all([
    qc.invalidateQueries({ queryKey: CATEGORIES_KEY }),
    qc.invalidateQueries({ queryKey: PRODUCTS_CATEGORIES_KEY }),
  ]);
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, CreateCategoryPayload>({
    mutationFn: async (payload) => {
      const { data, error } = await supabase.rpc('create_category_v1', {
        p_payload: payload as unknown as never,
      });
      if (error !== null) throw new Error(error.message);
      return data;
    },
    onSuccess: async () => {
      await invalidateCategoryCaches(qc);
    },
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { categoryId: string; patch: UpdateCategoryPatch }>({
    mutationFn: async ({ categoryId, patch }) => {
      const { data, error } = await supabase.rpc('update_category_v1', {
        p_category_id: categoryId,
        p_patch:       patch as unknown as never,
      });
      if (error !== null) throw new Error(error.message);
      return data;
    },
    onSuccess: async () => {
      await invalidateCategoryCaches(qc);
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
      await invalidateCategoryCaches(qc);
    },
  });
}
