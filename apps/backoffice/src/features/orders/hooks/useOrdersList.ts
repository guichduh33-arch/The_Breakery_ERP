// apps/backoffice/src/features/orders/hooks/useOrdersList.ts
// Session 32 / Wave 2.F — InfiniteQuery hook for the get_orders_list RPC
// (cursor-based pagination, JSONB filters).
// Session 33 / Wave 2.2 — bumped v1 → v2 (server-side filters).
// Review PR #367 — bumped v2 → v3 : curseur KEYSET (created_at, id). Le
// curseur v2 était le created_at de la ligne de peek filtrée strictement,
// qui perdait une commande par frontière de page ; le v3 pagine depuis la
// dernière ligne renvoyée, départagée par id.
// Lot 5 chantier 4 (2026-08-13) — bumped v3 → v4 : tri serveur blanc-listé
// (created_at | total | status | order_type, asc | desc). Le curseur devient
// le COUPLE (valeur_de_tri en texte, id) — clés next_cursor_val /
// next_cursor_id — pour que la pagination survive à n'importe quel tri.

import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export type OrdersSortColumn = 'created_at' | 'total' | 'status' | 'order_type';
export type OrdersSortDir = 'asc' | 'desc';

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
  terminal_id:            string | null;
  refund_status:          'none' | 'partial' | 'full';
  has_modifiers:          boolean;
  payment_method_primary: string | null;
  items_count:            number;
}

export interface OrdersListCursor {
  cursorVal: string;
  cursorId:  string | null;
}

export interface OrdersListPage {
  lines:           OrdersListLine[];
  next_cursor_val: string | null;
  next_cursor_id:  string | null;
  sort:            OrdersSortColumn;
  dir:             OrdersSortDir;
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
  refund_status?:  'none' | 'partial' | 'full';
  hour?:           number;
  terminal_id?:    string;
}

export interface UseOrdersListParams {
  start:    string;
  end:      string;
  filters?: OrdersListFilters;
  limit?:   number;
  sort?:    OrdersSortColumn;
  dir?:     OrdersSortDir;
}

/**
 * Sérialisation UNIQUE des filtres vers le jsonb serveur — partagée avec
 * useOrdersCounters (review PR #367 : deux copies identiques finissent par
 * diverger, et le pied « 12 of 240 » se met à mentir).
 */
export function toJsonbFilters(filters?: Partial<OrdersListFilters>): Record<string, string | number> {
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
      const cursor = pageParam as OrdersListCursor | null;
      const { data, error } = await supabase.rpc('get_orders_list_v4', {
        p_start:   params.start,
        p_end:     params.end,
        p_filters: toJsonbFilters(params.filters),
        p_limit:   params.limit ?? 50,
        p_sort:    params.sort ?? 'created_at',
        p_dir:     params.dir ?? 'desc',
        ...(cursor !== null
          ? {
              p_cursor_val: cursor.cursorVal,
              ...(cursor.cursorId !== null ? { p_cursor_id: cursor.cursorId } : {}),
            }
          : {}),
      });
      if (error) throw error as Error;
      return data as unknown as OrdersListPage;
    },
    initialPageParam: null as OrdersListCursor | null,
    getNextPageParam: (lastPage) =>
      lastPage.next_cursor_val === null
        ? undefined
        : { cursorVal: lastPage.next_cursor_val, cursorId: lastPage.next_cursor_id },
    enabled: Boolean(params.start && params.end),
  });
}
