// apps/backoffice/src/features/inventory-movements/hooks/useStockMovementsFeed.ts
// Session 13 / Phase 2.D — wrapper around get_stock_movements_v1 RPC (cursor paginated).

import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface MovementRow {
  id:                string;
  product_id:        string;
  product_sku:       string | null;
  product_name:      string | null;
  movement_type:     string;
  quantity:          number;
  unit:              string;
  reason:            string | null;
  unit_cost:         number | null;
  from_section_id:   string | null;
  from_section_code: string | null;
  to_section_id:     string | null;
  to_section_code:   string | null;
  supplier_id:       string | null;
  supplier_name:     string | null;
  reference_type:    string;
  reference_id:      string | null;
  lot_id:            string | null;
  created_at:        string;
  created_by:        string;
  author_name:       string | null;
  metadata:          Record<string, unknown>;
}

export interface MovementsFilters {
  sectionId?:    string;
  productId?:    string;
  movementType?: string;
  dateStart?:    string;
  dateEnd?:      string;
}

const PAGE_SIZE = 50;

type RpcFn = (
  fn: string,
  args?: Record<string, unknown>
) => Promise<{ data: MovementRow[] | null; error: { message: string } | null }>;

function rpc(): RpcFn {
  return supabase.rpc as unknown as RpcFn;
}

export const STOCK_MOVEMENTS_FEED_KEY = ['stock-movements-feed'] as const;

export function useStockMovementsFeed(filters: MovementsFilters = {}) {
  return useInfiniteQuery({
    queryKey: [...STOCK_MOVEMENTS_FEED_KEY, filters] as const,
    initialPageParam: { cursor: null as string | null, cursorId: null as string | null },
    queryFn: async ({ pageParam }) => {
      const args: Record<string, unknown> = { p_limit: PAGE_SIZE };
      if (filters.sectionId !== undefined && filters.sectionId !== '') {
        args.p_section_id = filters.sectionId;
      }
      if (filters.productId !== undefined && filters.productId !== '') {
        args.p_product_id = filters.productId;
      }
      if (filters.movementType !== undefined && filters.movementType !== '') {
        args.p_movement_type = filters.movementType;
      }
      if (filters.dateStart !== undefined && filters.dateStart !== '') {
        args.p_date_start = filters.dateStart;
      }
      if (filters.dateEnd !== undefined && filters.dateEnd !== '') {
        args.p_date_end = filters.dateEnd;
      }
      if (pageParam.cursor !== null) {
        args.p_cursor = pageParam.cursor;
        args.p_cursor_id = pageParam.cursorId;
      }
      const { data, error } = await rpc()('get_stock_movements_v1', args);
      if (error !== null) throw new Error(error.message);
      return data ?? [];
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      const last = lastPage[lastPage.length - 1];
      if (last === undefined) return undefined;
      return { cursor: last.created_at, cursorId: last.id };
    },
  });
}
