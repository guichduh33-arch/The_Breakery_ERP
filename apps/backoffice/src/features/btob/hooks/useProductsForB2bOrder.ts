// apps/backoffice/src/features/btob/hooks/useProductsForB2bOrder.ts
//
// Références et prix de saisie B2B. Le stock théorique n'est pas chargé par ce
// sélecteur opérationnel ; la disponibilité est indicative avant le retrait.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface B2bOrderProductOption {
  id:            string;
  sku:           string;
  name:          string;
  price:         number;
  current_stock: number | null;
  track_inventory: boolean;
  unit:          string | null;
}

export const B2B_ORDER_PRODUCTS_QUERY_KEY = ['b2b-order-products'] as const;

export function useProductsForB2bOrder() {
  return useQuery<B2bOrderProductOption[]>({
    queryKey: B2B_ORDER_PRODUCTS_QUERY_KEY,
    staleTime: 60_000,
    queryFn: async () => {
      // Le sélecteur est un catalogue ; le contrôle de stock bloquant appartient au retrait.
      const { data, error } = await supabase.from('products')
        .select('id,sku,name,price:retail_price,track_inventory,unit')
        .is('deleted_at', null).eq('is_active', true).order('name').limit(500);
      if (error) throw error;
      return (data ?? []).map((product) => ({ ...product, current_stock: null }));
    },
  });
}
