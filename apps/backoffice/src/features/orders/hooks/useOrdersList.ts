// apps/backoffice/src/features/orders/hooks/useOrdersList.ts
// Session 32 / Wave 2.F — InfiniteQuery hook for get_orders_list RPC
// (cursor-based pagination, JSONB filters).
// Session 33 / Wave 2.2 — bumped v1 → v2 (server-side refund_status,
// hour, terminal_id filters).

import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface OrdersListLine {
  id:                     string;
  order_number:           string;
  order_type:             string;
  status:                 string;
  total:                  number;
  created_at:             string;
  customer_id:            string | null;
  customer_name:          string | null;
  customer_type:          'retail' | 'b2b' | null;
  served_by:              string | null;
  served_by_name:         string | null;
  terminal_id:            string | null;                          // NEW S33
  refund_status:          'none' | 'partial' | 'full';
  has_modifiers:          boolean;
  payment_method_primary: string | null;
  items_count:            number;
}

export interface OrdersListPage {
  lines:       OrdersListLine[];
  next_cursor: string | null;
}

export interface OrdersListFilters {
  status?:         string;
  order_type?:     string;
  customer_id?:    string;
  served_by?:      string;
  total_min?:      number;
  total_max?:      number;
  customer_type?:  'retail' | 'b2b';
  payment_method?: string;
  // NEW S33 server-side filters
  refund_status?:  'none' | 'partial' | 'full';
  hour?:           number;
  terminal_id?:    string;
}

export interface UseOrdersListParams {
  start:    string;
  end:      string;
  filters?: OrdersListFilters;
  limit?:   number;
}

function toJsonbFilters(filters?: OrdersListFilters): Record<string, string | number> {
  if (!filters) return {};
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = v;
  }
  return out;
}

export function useOrdersList(params: UseOrdersListParams) {
  return useInfiniteQuery<OrdersListPage, Error>({
    queryKey: ['orders', 'list', params],
    queryFn: async ({ pageParam }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('get_orders_list_v2', {
        p_start:   params.start,
        p_end:     params.end,
        p_filters: toJsonbFilters(params.filters),
        p_limit:   params.limit ?? 50,
        p_cursor:  (pageParam as string | null) ?? null,
      });
      if (error) throw error as Error;
      return data as unknown as OrdersListPage;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: Boolean(params.start && params.end),
  });
}
