// apps/backoffice/src/features/inventory-alerts/hooks/useProductsWithoutThreshold.ts
//
// S3-10 — L'alerte de stock bas (`get_low_stock`) ne retient que les produits
// dont `min_stock_threshold > 0`. Un produit suivi sans seuil n'y apparaîtra
// jamais : une liste vide ne veut donc pas dire « tout va bien ». Ce crochet
// compte ces produits (actifs, non supprimés, `track_inventory = true`, seuil
// ≤ 0) pour que l'onglet le dise. Comptage seul (`head: true`), aucune ligne
// rapatriée ; `products` est lisible par tout utilisateur authentifié.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export const PRODUCTS_WITHOUT_THRESHOLD_KEY = ['products-without-low-stock-threshold'] as const;

export function useProductsWithoutThreshold() {
  return useQuery<number>({
    queryKey: PRODUCTS_WITHOUT_THRESHOLD_KEY,
    staleTime: 60_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('track_inventory', true)
        .eq('is_active', true)
        .is('deleted_at', null)
        .lte('min_stock_threshold', 0);
      if (error !== null) throw new Error(error.message);
      return count ?? 0;
    },
  });
}
