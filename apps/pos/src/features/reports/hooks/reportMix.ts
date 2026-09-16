import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ReportsPeriod } from './useReportsPeriod';
export interface POSReportsOrderTypeRow {
  orderType: string;
  revenue: number;
  orderCount: number;
  avgBasket: number;
  sharePct: number;
}

export interface POSReportsCategoryRow {
  categoryId: string | null;
  categoryName: string;
  revenue: number;
  qty: number;
  sharePct: number;
}

export interface POSReportsMix {
  totals: { revenue: number; orders: number };
  byOrderType: POSReportsOrderTypeRow[];
  byCategory: POSReportsCategoryRow[];
  timezone: string;
}

interface RawOrderTypeRow {
  order_type: string;
  revenue: number | string;
  order_count: number | string;
  avg_basket: number | string;
  share_pct: number | string;
}
interface RawCategoryRow {
  category_id: string | null;
  category_name: string;
  revenue: number | string;
  qty: number | string;
  share_pct: number | string;
}
interface MixPayload {
  timezone: string;
  totals: { revenue: number | string; orders: number | string };
  by_order_type: RawOrderTypeRow[];
  by_category: RawCategoryRow[];
}

export function usePOSReportsMix(period: ReportsPeriod) {
  return useQuery<POSReportsMix>({
    queryKey: ['pos-reports-mix', period.startDate, period.endDate],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_pos_order_type_category_mix_v1', {
        p_start_date: period.startDate,
        p_end_date: period.endDate,
      });
      if (error) throw new Error(error.message);
      const p = data as unknown as MixPayload;
      return {
        timezone: p.timezone,
        totals: {
          revenue: Number(p.totals?.revenue ?? 0),
          orders: Number(p.totals?.orders ?? 0),
        },
        byOrderType: (p.by_order_type ?? []).map((r) => ({
          orderType: r.order_type,
          revenue: Number(r.revenue),
          orderCount: Number(r.order_count),
          avgBasket: Number(r.avg_basket),
          sharePct: Number(r.share_pct),
        })),
        byCategory: (p.by_category ?? []).map((r) => ({
          categoryId: r.category_id,
          categoryName: r.category_name,
          revenue: Number(r.revenue),
          qty: Number(r.qty),
          sharePct: Number(r.share_pct),
        })),
      };
    },
    staleTime: 30_000,
  });
}


//
// Source of truth: server RPC `get_pos_top_products_v1(p_start_date, p_end_date)`.
// Line-level aggregation over the SAME order scope as the Overview / Mix
// (paid + completed retail, non-B2B, non-historical, no test-product line, WITA
// date bucketing; excludes cancelled + promo-gift lines), so the product
// revenue reconciles with the Mix by-category revenue. The RPC returns all
// products sorted by revenue DESC; the caller slices the top-N it wants.
