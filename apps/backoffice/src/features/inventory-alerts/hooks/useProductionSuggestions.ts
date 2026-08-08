// apps/backoffice/src/features/inventory-alerts/hooks/useProductionSuggestions.ts
//
// Lecteur de get_production_suggestions_v1.
//
// Extrait de ProductionAlertsTab le 2026-08-08 : l'onglet et le compteur de son
// en-tête lisent la même chose, et une clé de requête écrite à deux endroits
// finit par diverger — react-query servirait alors deux caches pour une seule
// vérité.
//
// La RPC peut ne pas être déployée ; on dégrade vers une liste vide plutôt que
// de faire échouer la page entière pour un onglet.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface ProductionSuggestion {
  product_id:         string;
  product_sku:        string;
  product_name:       string;
  current_stock:      number;
  avg_daily_sales:    number;
  days_of_stock:      number | null;
  suggested_quantity: number;
  priority:           string;
}

type RpcFn = (
  fn: string, args?: Record<string, unknown>
) => Promise<{ data: ProductionSuggestion[] | null; error: { message: string } | null }>;

export const PRODUCTION_SUGGESTIONS_KEY = ['production-suggestions'] as const;

export function useProductionSuggestions() {
  return useQuery<ProductionSuggestion[]>({
    queryKey: PRODUCTION_SUGGESTIONS_KEY,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const rpc = supabase.rpc.bind(supabase) as unknown as RpcFn;
      const { data, error } = await rpc('get_production_suggestions_v1', {});
      if (error !== null) {
        if (/does not exist|undefined function/i.test(error.message)) return [];
        throw new Error(error.message);
      }
      return data ?? [];
    },
  });
}
