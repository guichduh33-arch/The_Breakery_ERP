// apps/backoffice/src/features/inventory/hooks/useStockLevels.ts
//
// Lignes de la liste de stock (`get_stock_levels_v3`). Les filtres sont
// résolus côté serveur : l'aller-retour reste petit même à plusieurs milliers
// de produits.
//
// ADR-024 déc. 1 — cette fonction ne renvoie PLUS de total. Les agrégats vivent
// dans `useStockCounters`, parce qu'un total recopié sur chaque ligne cesse
// d'exister dès que le filtre ne ramène aucune ligne : le pied ne pouvait alors
// plus dire « 0 sur N », au moment précis où c'est utile.

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import type { Database } from '@breakery/supabase';
import { supabase } from '@/lib/supabase.js';

/** ADR-024 déc. 3 — dérivé de l'enum Postgres, jamais réécrit à la main. */
export type StockBucket = Database['public']['Enums']['stock_bucket'];

export interface StockLevelRow {
  product_id:           string;
  sku:                  string;
  name:                 string;
  category_id:          string | null;
  category_name:        string | null;
  current_stock:        number;
  min_stock_threshold:  number;
  track_inventory:      boolean;
  /** Unité de mesure du produit (`pcs`, `kg`, `g`…). Toujours servie. */
  unit:                 string;
  /** `current_stock × cost_price`. ADR-014 : diverge du GL entre deux opnames. */
  stock_value:          number;
  last_movement_at:     string | null;
}

export interface StockLevelsFilters {
  categoryId?:  string;
  search?:      string;
  bucket?:      StockBucket;
  limit?:       number;
  offset?:      number;
}

// Racine partagée avec `useStockCounters` : React Query invalide par préfixe,
// donc une invalidation de cette clé rafraîchit AUSSI les compteurs. Sans quoi
// une perte enregistrée mettrait la liste à jour en laissant les compteurs
// mentir — le défaut que l'ADR-024 corrige, réintroduit par la porte de service.
export const STOCK_LEVELS_QUERY_KEY = ['stock-levels'] as const;

const DEFAULT_LIMIT = 50;

export function useStockLevels(filters: StockLevelsFilters = {}) {
  const limit  = filters.limit  ?? DEFAULT_LIMIT;
  const offset = filters.offset ?? 0;
  const bucket = filters.bucket ?? 'all';

  return useQuery<StockLevelRow[]>({
    queryKey: [...STOCK_LEVELS_QUERY_KEY, { ...filters, limit, offset, bucket }] as const,
    staleTime: 30_000,
    // Sans ceci, chaque changement de clé — panier, page, recherche — repasse
    // la requête en `isLoading`, la table est démontée au profit du squelette,
    // et la page saute. Les lignes précédentes tiennent l'écran le temps que
    // les nouvelles arrivent ; `isLoading` ne vaut plus que pour le tout
    // premier chargement.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const args: {
        p_category_id?:  string;
        p_search?:       string;
        p_bucket?:       StockBucket;
        p_limit?:        number;
        p_offset?:       number;
      } = {
        p_bucket: bucket,
        p_limit:  limit,
        p_offset: offset,
      };
      if (filters.categoryId !== undefined && filters.categoryId !== '') {
        args.p_category_id = filters.categoryId;
      }
      if (filters.search !== undefined && filters.search.trim() !== '') {
        args.p_search = filters.search.trim();
      }

      const { data, error } = await supabase.rpc('get_stock_levels_v3', args);
      if (error) throw error;
      return data ?? [];
    },
  });
}
