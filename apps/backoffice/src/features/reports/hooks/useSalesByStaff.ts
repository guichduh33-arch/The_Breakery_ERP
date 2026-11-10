// apps/backoffice/src/features/reports/hooks/useSalesByStaff.ts
//
// Wraps la famille `get_sales_by_staff` (p_date_start, p_date_end, p_filters?).
// S3-22 (2026-11-11) — `p_filters` restreint la portée des commandes
// (type, moyen de paiement, table), mêmes prédicats que
// `get_sales_by_product`. Sans filtre, l'argument est OMIS : la réponse est
// celle d'avant (Daily Sales l'appelle ainsi). Colonnes inchangées.
// ADR-009 déc. 4 — bumped v1 → v2 (status IN paid, completed).
// Audit Reports 2026-08-01 lot C / D1 — bumped v2 -> v3 : la v2 etait SECURITY
// INVOKER sans gate, donc lisible par tout compte authentifie (la RLS de
// `orders` a pour predicat is_authenticated()). v3 est SECURITY DEFINER et
// gatee sur reports.sales.read.

import { useQuery } from '@tanstack/react-query';
import type { Json } from '@breakery/supabase';
import { supabase } from '@/lib/supabase.js';
import {
  salesFiltersKey, toRpcFilters, type SalesOrderFilters,
} from '../utils/salesFilters.js';

export interface SalesStaffRow {
  staff_id:    string;
  staff_name:  string;
  total:       number;
  order_count: number;
  avg_basket:  number;
}

export const SALES_BY_STAFF_QK = ['reports', 'sales-by-staff'] as const;

export function useSalesByStaff(
  dateStart: string,
  dateEnd:   string,
  filters?:  SalesOrderFilters,
) {
  return useQuery<SalesStaffRow[]>({
    queryKey: [...SALES_BY_STAFF_QK, dateStart, dateEnd, ...salesFiltersKey(filters)] as const,
    staleTime: 60_000,
    queryFn: async () => {
      // `exactOptionalPropertyTypes` : on omet l'arg optionnel plutôt que de
      // poser `undefined`.
      const args: { p_date_start: string; p_date_end: string; p_filters?: Json } = {
        p_date_start: dateStart,
        p_date_end:   dateEnd,
      };
      const rpcFilters = toRpcFilters(filters);
      if (rpcFilters !== null) args.p_filters = rpcFilters;
      const { data, error } = await supabase.rpc('get_sales_by_staff_v6', args);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        staff_id:    r.staff_id,
        staff_name:  r.staff_name,
        total:       Number(r.total),
        order_count: Number(r.order_count),
        avg_basket:  Number(r.avg_basket),
      }));
    },
  });
}
