// apps/backoffice/src/features/reports/hooks/useStaffPerformance.ts
// S40 Wave B1 — Query hook for get_staff_performance_v1 RPC.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface StaffPerformanceRow {
  staff_id:              string;
  staff_name:            string;
  orders_served:         number;
  revenue:               number;
  aov:                   number;
  items_per_order:       number;
  voids_count:           number;
  voids_value:           number;
  refunds_count:         number;
  refunds_value:         number;
  discount_orders_count: number;
  discount_value:        number;
  items_cancelled:       number;
}

export interface StaffPerformanceData {
  period:    { start: string; end: string };
  by_staff:  StaffPerformanceRow[];
}

export interface UseStaffPerformanceParams {
  start: string;
  end:   string;
}

export function useStaffPerformance(params: UseStaffPerformanceParams) {
  return useQuery<StaffPerformanceData, Error>({
    queryKey: ['reports', 'staff-performance', params.start, params.end],
    queryFn:  async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('get_staff_performance_v1', {
        p_date_start: params.start,
        p_date_end:   params.end,
      });
      if (error) throw error as Error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (data ?? {}) as any;
      return {
        period:   raw.period   ?? { start: params.start, end: params.end },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        by_staff: ((raw.by_staff ?? []) as any[]).map((r) => ({
          staff_id:              r.staff_id              ?? '',
          staff_name:            r.staff_name            ?? '',
          orders_served:         Number(r.orders_served         ?? 0),
          revenue:               Number(r.revenue               ?? 0),
          aov:                   Number(r.aov                   ?? 0),
          items_per_order:       Number(r.items_per_order       ?? 0),
          voids_count:           Number(r.voids_count           ?? 0),
          voids_value:           Number(r.voids_value           ?? 0),
          refunds_count:         Number(r.refunds_count         ?? 0),
          refunds_value:         Number(r.refunds_value         ?? 0),
          discount_orders_count: Number(r.discount_orders_count ?? 0),
          discount_value:        Number(r.discount_value        ?? 0),
          items_cancelled:       Number(r.items_cancelled       ?? 0),
        })) as StaffPerformanceRow[],
      } satisfies StaffPerformanceData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
