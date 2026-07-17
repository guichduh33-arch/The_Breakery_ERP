// apps/backoffice/src/features/reports/hooks/useSalesByHour.ts
//
// Wraps the RPC `get_sales_by_hour_v3(p_date)`. Returns 24 rows
// S50 W1.2 — bumped v1 → v2 (permission gate: reports.read; LANGUAGE sql → plpgsql).
// ADR-009 déc. 4 — bumped v2 → v3 (status IN paid, completed).
// (hour 0..23) zero-filled for the day requested. Date is interpreted in
// `business_config.timezone` (Asia/Makassar by default).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface SalesHourRow {
  hour:        number;
  total:       number;
  order_count: number;
}

export const SALES_BY_HOUR_QK = ['reports', 'sales-by-hour'] as const;

export function useSalesByHour(date: string /* YYYY-MM-DD */) {
  return useQuery<SalesHourRow[]>({
    queryKey: [...SALES_BY_HOUR_QK, date] as const,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_sales_by_hour_v3', { p_date: date });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        hour:        Number(r.hour),
        total:       Number(r.total),
        order_count: Number(r.order_count),
      }));
    },
  });
}
