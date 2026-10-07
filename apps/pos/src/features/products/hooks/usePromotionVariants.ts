import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useSaleQueryEnabled } from '@/features/lan/hooks/useSaleQueryEnabled';
import type { POSVariantRow } from './useProductVariants';

type Variant = POSVariantRow & { parent_product_id: string };

export async function fetchPromotionVariants(parentIds: string[]): Promise<Variant[]> {
  const rows: Variant[] = [];
  for (let start = 0; start < parentIds.length; start += 100) {
    for (let page = 0; ; page += 1) {
      const { data, error } = await supabase.from('products')
        .select('id, parent_product_id, name, retail_price, variant_label, variant_axis, variant_sort_order, is_active, current_stock, deduct_stock')
        .in('parent_product_id', parentIds.slice(start, start + 100))
        .eq('is_active', true).eq('visible_on_pos', true).is('deleted_at', null)
        .order('id', { ascending: true }).range(page * 500, page * 500 + 499);
      if (error) throw error;
      rows.push(...(data ?? []) as Variant[]);
      if ((data?.length ?? 0) < 500) break;
    }
  }
  return rows;
}

/** Le cache par parent demeure la source du snapshot hors ligne et du sélecteur. */
export function usePromotionVariants(parentIds: string[]): Map<string, POSVariantRow[]> {
  const client = useQueryClient();
  const enabled = useSaleQueryEnabled(parentIds.length > 0);
  const ids = [...parentIds].sort();
  const revision = useRef(0);
  const subscribe = useCallback((notify: () => void) => client.getQueryCache().subscribe((event) => {
    const queryKey = event.query.queryKey as readonly unknown[];
    if (queryKey[0] === 'pos-product-variants') { revision.current++; notify(); }
  }), [client]);
  const version = useSyncExternalStore(subscribe, () => revision.current);
  useQuery({
    queryKey: ['pos-product-variants-batch', ids], enabled,
    queryFn: async () => {
      const rows = await fetchPromotionVariants(ids);
      for (const id of ids) client.setQueryData(['pos-product-variants', id], rows.filter((row) => row.parent_product_id === id).sort((a, b) => a.variant_sort_order - b.variant_sort_order));
      return rows;
    },
  });
  const key = JSON.stringify(ids);
  return useMemo(() => {
    // Une écriture du cache par parent renouvelle cette projection.
    void version;
    return new Map((JSON.parse(key) as string[]).map((id) => [id, client.getQueryData<POSVariantRow[]>(['pos-product-variants', id]) ?? []]));
  }, [client, key, version]);
}
