// apps/backoffice/src/features/reports/hooks/useStaffPerformance.ts
// S40 Wave B1 — Query hook for get_staff_performance_v1 RPC.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { asArray, asRecord, toNum, toStr } from '../utils/parse.js';

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
      const { data, error } = await supabase.rpc('get_staff_performance_v1', {
        p_date_start: params.start,
        p_date_end:   params.end,
      });
      if (error) throw error as Error;
      const raw    = asRecord(data);
      const period = asRecord(raw.period);
      return {
        period: {
          start: toStr(period.start, params.start),
          end:   toStr(period.end,   params.end),
        },
        by_staff: asArray(raw.by_staff).map((r): StaffPerformanceRow => {
          const o = asRecord(r);
          return {
            staff_id:              toStr(o.staff_id),
            staff_name:            toStr(o.staff_name, '—'),
            orders_served:         toNum(o.orders_served),
            revenue:               toNum(o.revenue),
            aov:                   toNum(o.aov),
            items_per_order:       toNum(o.items_per_order),
            voids_count:           toNum(o.voids_count),
            voids_value:           toNum(o.voids_value),
            refunds_count:         toNum(o.refunds_count),
            refunds_value:         toNum(o.refunds_value),
            discount_orders_count: toNum(o.discount_orders_count),
            discount_value:        toNum(o.discount_value),
            items_cancelled:       toNum(o.items_cancelled),
          };
        }),
      } satisfies StaffPerformanceData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
