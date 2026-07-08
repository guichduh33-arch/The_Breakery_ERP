// apps/backoffice/src/features/customers/hooks/useCustomerCategoryMutations.ts
//
// S69 Volet A (Task 3) — write mutations for customer_categories, wired to
// the CRUD RPCs shipped in Task 1 (migration 20260710000135):
// create_customer_category_v1 / update_customer_category_v1 /
// delete_customer_category_v1. Closes deviation D-W6-CUSTCAT-01 — the page
// was read-only for lack of write RPCs.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { CUSTOMER_CATEGORIES_QUERY_KEY } from './useCustomerCategories.js';
import type { PriceModifierType } from '@breakery/domain';

export interface CategoryInput {
  name: string;
  slug: string;
  price_modifier_type: PriceModifierType;
  discount_percentage: number;
  points_multiplier: number;
  loyalty_enabled: boolean;
  color: string | null;
  icon: string | null;
  is_default: boolean;
}

/** Maps the server-side error message substrings (RAISE EXCEPTION messages
 * from the 3 RPCs) to a user-facing string. Mirrors the classify() pattern
 * used across other feature hooks (e.g. useCancelB2bOrder). */
export function classifyCategoryError(err: unknown): string {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes('slug_taken') || msg.includes('slug_required')) return 'This slug is already in use.';
  if (msg.includes('invalid_discount')) return 'Discount must be between 0 and 100.';
  if (msg.includes('invalid_multiplier')) return 'Points multiplier must be ≥ 0.';
  if (msg.includes('category_in_use')) return 'Cannot delete: customers are still assigned to this category.';
  if (msg.includes('cannot_delete_default')) return 'The default category cannot be deleted.';
  if (msg.includes('default_required')) return 'There must always be one default category.';
  if (msg.includes('category_not_found')) return 'Category not found.';
  if (msg.includes('permission_denied')) return 'You do not have permission for this action.';
  return 'Something went wrong. Please try again.';
}

export function useCreateCustomerCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CategoryInput) => {
      const { data, error } = await supabase.rpc(
        'create_customer_category_v1',
        {
          p_name: input.name,
          p_slug: input.slug,
          p_price_modifier_type: input.price_modifier_type,
          p_discount_percentage: input.discount_percentage,
          p_points_multiplier: input.points_multiplier,
          p_loyalty_enabled: input.loyalty_enabled,
          // Generated RPC Args type p_color/p_icon as non-nullable string, but the
          // RPC body + column accept NULL. Scoped cast keeps the other args type-checked.
          p_color: input.color as unknown as string,
          p_icon: input.icon as unknown as string,
          p_is_default: input.is_default,
        },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CUSTOMER_CATEGORIES_QUERY_KEY }),
  });
}

export function useUpdateCustomerCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CategoryInput & { id: string }) => {
      const { data, error } = await supabase.rpc(
        'update_customer_category_v1',
        {
          p_id: input.id,
          p_name: input.name,
          p_slug: input.slug,
          p_price_modifier_type: input.price_modifier_type,
          p_discount_percentage: input.discount_percentage,
          p_points_multiplier: input.points_multiplier,
          p_loyalty_enabled: input.loyalty_enabled,
          p_color: input.color as unknown as string,
          p_icon: input.icon as unknown as string,
          p_is_default: input.is_default,
        },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CUSTOMER_CATEGORIES_QUERY_KEY }),
  });
}

export function useDeleteCustomerCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('delete_customer_category_v1', { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CUSTOMER_CATEGORIES_QUERY_KEY }),
  });
}
