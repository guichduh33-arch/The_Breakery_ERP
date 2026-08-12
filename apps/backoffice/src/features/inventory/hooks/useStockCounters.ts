// apps/backoffice/src/features/inventory/hooks/useStockCounters.ts
//
// Agrégats de la liste de stock (`get_stock_counters_v1`). ADR-024 déc. 1-2.
//
// Deux propriétés portent tout l'intérêt de cette séparation :
//   · les compteurs existent même quand la liste ne ramène AUCUNE ligne, donc
//     le pied peut dire « 0 sur 318 » plutôt que « 0 sur 0 » ;
//   · ils ne dépendent pas de la pagination, donc changer de page ne les
//     recharge pas — la clé de requête ne porte volontairement ni `limit`,
//     ni `offset`, ni le panier actif.
//
// Les paniers se RECOUVRENT : `low` inclut `zero` et `negative`. La somme des
// compteurs n'est donc pas le total, et l'interface doit le dire.

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { STOCK_LEVELS_QUERY_KEY } from './useStockLevels.js';

export interface StockCounters {
  total_count:      number;
  low_count:        number;
  zero_count:       number;
  negative_count:   number;
  untracked_count:  number;
}

export interface StockCountersFilters {
  categoryId?:  string;
  search?:      string;
}

const EMPTY: StockCounters = {
  total_count: 0, low_count: 0, zero_count: 0, negative_count: 0, untracked_count: 0,
};

// Sous le préfixe de la liste : une invalidation de `STOCK_LEVELS_QUERY_KEY`
// après une écriture de stock rafraîchit lignes ET compteurs d'un seul geste.
export const STOCK_COUNTERS_QUERY_KEY = [...STOCK_LEVELS_QUERY_KEY, 'counters'] as const;

export function useStockCounters(filters: StockCountersFilters = {}) {
  return useQuery<StockCounters>({
    queryKey: [...STOCK_COUNTERS_QUERY_KEY, { ...filters }] as const,
    staleTime: 30_000,
    // Les compteurs sont lus en permanence pendant que l'utilisateur tape :
    // les laisser retomber à 0 entre deux réponses ferait clignoter cinq
    // chiffres et le pied à chaque frappe.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const args: { p_category_id?: string; p_search?: string } = {};
      if (filters.categoryId !== undefined && filters.categoryId !== '') {
        args.p_category_id = filters.categoryId;
      }
      if (filters.search !== undefined && filters.search.trim() !== '') {
        args.p_search = filters.search.trim();
      }

      const { data, error } = await supabase.rpc('get_stock_counters_v1', args);
      if (error) throw error;
      // La RPC rend toujours exactement une ligne, y compris sur un catalogue
      // vide (les agrégats d'un ensemble vide valent 0). Le repli couvre le
      // seul cas résiduel : une réponse tronquée.
      return data?.[0] ?? EMPTY;
    },
  });
}
