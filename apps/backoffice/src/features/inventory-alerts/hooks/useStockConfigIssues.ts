// apps/backoffice/src/features/inventory-alerts/hooks/useStockConfigIssues.ts
// Audit 2026-07-08 — get_stock_config_issues_v1 wrapper.
// Produits dont les flags track_inventory/deduct_stock + recette ne déduisent
// pas le stock attendu à la vente.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export type StockConfigSeverity = 'critical' | 'warning' | 'info';
export type StockConfigIssueType =
  | 'negative_stock'
  | 'sale_deduct_no_recipe'
  | 'orphan_recipe'
  | 'tracked_recipe_at_prod';

export interface StockConfigIssueRow {
  product_id:      string;
  sku:             string;
  name:            string;
  category_name:   string | null;
  issue_type:      StockConfigIssueType;
  severity:        StockConfigSeverity;
  track_inventory: boolean;
  deduct_stock:    boolean;
  recipe_lines:    number;
  current_stock:   number;
}

type RpcFn = (
  fn: string, args?: Record<string, unknown>
) => Promise<{ data: StockConfigIssueRow[] | null; error: { message: string } | null }>;

function rpc(): RpcFn {
  return supabase.rpc.bind(supabase) as unknown as RpcFn;
}

export const STOCK_CONFIG_ISSUES_KEY = ['stock-config-issues-v1'] as const;

export function useStockConfigIssues() {
  return useQuery<StockConfigIssueRow[]>({
    queryKey: STOCK_CONFIG_ISSUES_KEY,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await rpc()('get_stock_config_issues_v1');
      if (error !== null) throw new Error(error.message);
      return data ?? [];
    },
  });
}
