// apps/backoffice/src/features/reports/hooks/useRecipeCostHistory.ts
//
// Lot A1 (campagne Reports 2026-08-15) — extrait des deux pages RecipeCost*,
// qui appelaient `recipe_cost_history_v1` en useQuery inline : seules pages du
// module sans hook dédié. La RPC a deux modes selon `p_product_id` :
//   - omis  → overview : une ligne par produit (delta sur la fenêtre) ;
//   - fourni → timeline : une ligne par version de recette du produit.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface RecipeCostOverviewRow {
  product_id:    string;
  product_name:  string;
  cost_per_unit: number | null; // current cost (≤ p_to)
  baseline_cost: number | null;
  delta_pct:     number | null;
  change_count:  number;
  created_at:    string | null; // last_change_date in overview mode
}

export interface RecipeCostTimelineRow {
  product_id:     string;
  product_name:   string;
  version_number: number;
  created_at:     string;
  cost_per_unit:  number;
  change_note:    string | null;
}

export function useRecipeCostOverview(start: string, end: string) {
  return useQuery<RecipeCostOverviewRow[]>({
    queryKey: ['reports', 'recipe-cost', 'overview', start, end] as const,
    staleTime: 60_000,
    queryFn: async (): Promise<RecipeCostOverviewRow[]> => {
      const { data, error } = await supabase.rpc('recipe_cost_history_v1', {
        p_from: start,
        p_to: end,
        // omit p_product_id → PostgreSQL DEFAULT NULL → overview mode
      });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useRecipeCostTimeline(productId: string, from: string, to: string) {
  return useQuery<RecipeCostTimelineRow[]>({
    queryKey: ['reports', 'recipe-cost', 'timeline', productId, from, to] as const,
    enabled: productId !== '',
    staleTime: 60_000,
    queryFn: async (): Promise<RecipeCostTimelineRow[]> => {
      const { data, error } = await supabase.rpc('recipe_cost_history_v1', {
        p_from: from,
        p_to: to,
        p_product_id: productId,
      });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}
