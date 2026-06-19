// apps/pos/src/features/combos/hooks/useComboItems.ts
//
// Session 47: the fixed `combo_items` table was replaced by the choice-group
// model (combo_groups + combo_group_options). This read-path hook now surfaces
// a combo's available option products (flattened) so existing cart rendering
// keeps compiling. The richer per-line configuration is handled by
// `useComboConfig` + ComboConfigModal (Wave D).
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface ComboItemWithProduct {
  component_product_id: string;
  quantity: number;
  sort_order: number;
  product: { id: string; name: string };
}

export function useComboItems(parentProductId: string) {
  return useQuery<ComboItemWithProduct[]>({
    queryKey: ['combo_items', parentProductId],
    queryFn: async () => {
      const { data: groups, error: gErr } = await supabase
        .from('combo_groups')
        .select('id, sort_order')
        .eq('combo_product_id', parentProductId)
        .order('sort_order');
      if (gErr) throw gErr;
      const groupIds = (groups ?? []).map((g) => g.id);
      if (groupIds.length === 0) return [];

      const { data, error } = await supabase
        .from('combo_group_options')
        .select('component_product_id, sort_order, product:products!component_product_id(id, name)')
        .in('group_id', groupIds)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []).map((o) => {
        const prod = Array.isArray(o.product) ? o.product[0] : o.product;
        return {
          component_product_id: o.component_product_id,
          quantity: 1,
          sort_order: o.sort_order,
          product: { id: prod?.id ?? o.component_product_id, name: prod?.name ?? '—' },
        };
      });
    },
    staleTime: 5 * 60_000,
    enabled: Boolean(parentProductId),
  });
}
