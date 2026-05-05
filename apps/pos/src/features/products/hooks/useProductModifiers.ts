// apps/pos/src/features/products/hooks/useProductModifiers.ts
//
// Fetch the modifier rows attached either to a product OR to its category
// (XOR scope, spec §3.1). The DB returns a flat list; `mergeGroups()` folds
// them into a sorted, grouped structure with product-level overrides winning.
//
// NOTE: the generated Supabase type set in `@breakery/supabase` does not yet
// include the `product_modifiers` table (the migration agent owns that file
// and will regenerate types after applying the new migrations). Until then we
// describe the row shape locally and treat the supabase client as untyped for
// this single call.
import { useQuery } from '@tanstack/react-query';
import {
  mergeGroups,
  type ModifierGroup,
  type ProductModifierRow,
} from '@breakery/domain';
import { supabase } from '@/lib/supabase';

export interface UseProductModifiersArgs {
  productId: string;
  categoryId: string | null;
  /** Disable the query when the product has no modifiers expected. */
  enabled?: boolean;
}

const MODIFIER_COLUMNS =
  'id, product_id, category_id, group_name, group_sort_order, group_required, group_type, option_label, option_icon, option_sort_order, price_adjustment, is_default, is_active';

/**
 * Minimal builder shape we rely on. Until `product_modifiers` is part of the
 * generated Database types, we coerce the client through `unknown` to a tiny
 * structural interface that exposes only the chain calls we need.
 */
interface ModifierQueryBuilder {
  from(table: string): {
    select(columns: string): {
      or(filter: string): {
        eq(column: string, value: unknown): {
          is(column: string, value: unknown): Promise<{
            data: ProductModifierRow[] | null;
            error: Error | null;
          }>;
        };
      };
    };
  };
}

export function useProductModifiers({
  productId,
  categoryId,
  enabled = true,
}: UseProductModifiersArgs) {
  return useQuery<ModifierGroup[]>({
    queryKey: ['product-modifiers', productId, categoryId],
    enabled,
    queryFn: async (): Promise<ModifierGroup[]> => {
      const orParts: string[] = [`product_id.eq.${productId}`];
      if (categoryId) orParts.push(`category_id.eq.${categoryId}`);

      // Cast through unknown — see file header NOTE.
      const client = supabase as unknown as ModifierQueryBuilder;
      const { data, error } = await client
        .from('product_modifiers')
        .select(MODIFIER_COLUMNS)
        .or(orParts.join(','))
        .eq('is_active', true)
        .is('deleted_at', null);

      if (error) throw error;
      const rows = data ?? [];
      return mergeGroups(rows);
    },
  });
}
