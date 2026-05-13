// apps/backoffice/src/features/inventory-production/hooks/useProductionSuggestions.ts
//
// Calls `get_production_suggestions_v1` — finished products whose sales velocity
// vs current stock implies a need to (re-)produce.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface ProductionSuggestion {
  product_id: string;
  product_name: string;
  product_sku: string;
  avg_daily_sales: number;
  current_stock: number;
  days_of_stock: number | null;
  suggested_quantity: number;
  priority: 'high' | 'medium' | 'low';
}

export function useProductionSuggestions(opts?: {
  lookbackDays?: number;
  priorityHigh?: number;
  priorityMedium?: number;
}) {
  return useQuery<ProductionSuggestion[]>({
    queryKey: ['inventory-production', 'suggestions', opts] as const,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_production_suggestions_v1', {
        p_lookback_days:   opts?.lookbackDays   ?? 7,
        p_priority_high:   opts?.priorityHigh   ?? 3,
        p_priority_medium: opts?.priorityMedium ?? 7,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        product_id: r.product_id,
        product_name: r.product_name,
        product_sku: r.product_sku,
        avg_daily_sales: Number(r.avg_daily_sales),
        current_stock: Number(r.current_stock),
        days_of_stock: r.days_of_stock === null ? null : Number(r.days_of_stock),
        suggested_quantity: Number(r.suggested_quantity),
        priority: r.priority as ProductionSuggestion['priority'],
      }));
    },
  });
}
