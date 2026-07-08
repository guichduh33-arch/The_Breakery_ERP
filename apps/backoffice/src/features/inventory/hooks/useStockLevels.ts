// apps/backoffice/src/features/inventory/hooks/useStockLevels.ts
//
// Calls `get_stock_levels_v1` RPC. Server-side filters keep the round-trip
// small even with thousands of products. Returns one row per product with
// the most recent movement timestamp + category labels.
//
// Spec ref: docs/superpowers/specs/2026-05-11-session-12-inventory-mvp-spec.md §3 (read path)

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface StockLevelRow {
  product_id:           string;
  sku:                  string;
  name:                 string;
  category_id:          string | null;
  category_name:        string | null;
  current_stock:        number;
  min_stock_threshold:  number;
  track_inventory?:     boolean;
  last_movement_at:     string | null;
  total_count:          number;
}

export interface StockLevelsFilters {
  categoryId?:    string;
  search?:        string;
  lowStockOnly?:  boolean;
  limit?:         number;
  offset?:        number;
}

export const STOCK_LEVELS_QUERY_KEY = ['stock-levels'] as const;

const DEFAULT_LIMIT = 50;

export function useStockLevels(filters: StockLevelsFilters = {}) {
  const limit  = filters.limit  ?? DEFAULT_LIMIT;
  const offset = filters.offset ?? 0;
  const lowStockOnly = filters.lowStockOnly ?? false;

  return useQuery<StockLevelRow[]>({
    queryKey: [...STOCK_LEVELS_QUERY_KEY, { ...filters, limit, offset, lowStockOnly }] as const,
    staleTime: 30_000,
    queryFn: async () => {
      const args: {
        p_category_id?:     string;
        p_search?:          string;
        p_low_stock_only?:  boolean;
        p_limit?:           number;
        p_offset?:          number;
      } = {
        p_low_stock_only: lowStockOnly,
        p_limit:          limit,
        p_offset:         offset,
      };
      if (filters.categoryId !== undefined && filters.categoryId !== '') {
        args.p_category_id = filters.categoryId;
      }
      if (filters.search !== undefined && filters.search.trim() !== '') {
        args.p_search = filters.search.trim();
      }

      const { data, error } = await supabase.rpc('get_stock_levels_v2', args);
      if (error) throw error;
      return data ?? [];
    },
  });
}
