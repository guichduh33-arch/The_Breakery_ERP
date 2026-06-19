// apps/backoffice/src/features/combos/hooks/useFinishedProductsForCombo.ts
//
// Session 47 — Fetches products eligible as combo options:
// product_type='finished', not a variant parent, not already a combo.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface ComboOptionProduct {
  id: string;
  sku: string;
  name: string;
  retail_price: number;
  variant_label: string | null;
}

export function useFinishedProductsForCombo() {
  return useQuery<ComboOptionProduct[]>({
    queryKey: ['products-for-combo-option'] as const,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, sku, name, retail_price, variant_label, parent_product_id')
        .eq('product_type', 'finished')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name');
      if (error) throw error;
      const rows = (data ?? []) as Array<{
        id: string;
        sku: string;
        name: string;
        retail_price: number;
        variant_label: string | null;
        parent_product_id: string | null;
      }>;
      // Exclude variant parents (any row that is referenced as parent_product_id)
      const parentIds = new Set(rows.map((r) => r.parent_product_id).filter(Boolean));
      return rows
        .filter((r) => !parentIds.has(r.id))
        .map(({ id, sku, name, retail_price, variant_label }) => ({
          id,
          sku,
          name,
          retail_price,
          variant_label,
        }));
    },
  });
}
