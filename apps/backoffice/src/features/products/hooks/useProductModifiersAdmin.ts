// apps/backoffice/src/features/products/hooks/useProductModifiersAdmin.ts
//
// Loads a product's modifier rows (product-scoped) and folds them into the
// editable group structure used by ModifiersPanel. Includes the raw
// ingredients_to_deduct JSONB so the editor round-trips it.

import { useQuery } from '@tanstack/react-query';
import {
  foldModifierRowsForEdit,
  type AdminProductModifierRow,
  type EditableModifierGroup,
} from '@breakery/domain';
import { supabase } from '@/lib/supabase.js';

const ADMIN_MODIFIER_COLUMNS =
  'id, product_id, category_id, group_name, group_sort_order, group_required, ' +
  'group_type, option_label, option_icon, option_sort_order, price_adjustment, ' +
  'is_default, is_active, ingredients_to_deduct';

export function productModifiersAdminKey(productId: string) {
  return ['product-modifiers-admin', productId] as const;
}

export function useProductModifiersAdmin(productId: string) {
  return useQuery<EditableModifierGroup[]>({
    queryKey: productModifiersAdminKey(productId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_modifiers')
        .select(ADMIN_MODIFIER_COLUMNS)
        .eq('product_id', productId)
        .eq('is_active', true)
        .is('deleted_at', null);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as AdminProductModifierRow[];
      return foldModifierRowsForEdit(rows);
    },
  });
}
