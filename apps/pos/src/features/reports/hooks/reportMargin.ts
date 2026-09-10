import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ReportsPeriod } from './useReportsPeriod';
export interface POSReportsMarginSummary {
  revenueTtc: number;
  revenueHt: number;
  cogs: number;
  grossMargin: number;
  marginPct: number;
  orders: number;
  /** Products sold with NULL/0 cost_price — margin is overstated when > 0. */
  productsWithoutCost: number;
}

export interface POSReportsMarginProductRow {
  productId: string;
  productName: string;
  categoryName: string;
  qty: number;
  revenueHt: number;
  cogs: number;
  margin: number;
  marginPct: number;
}

export interface POSReportsMarginCategoryRow {
  categoryId: string | null;
  categoryName: string;
  qty: number;
  revenueHt: number;
  cogs: number;
  margin: number;
  marginPct: number;
}

export interface POSReportsMargin {
  summary: POSReportsMarginSummary;
  byProduct: POSReportsMarginProductRow[];
  byCategory: POSReportsMarginCategoryRow[];
  timezone: string;
}

interface RawMarginProductRow {
  product_id: string;
  product_name: string;
  category_name: string;
  qty: number | string;
  revenue_ht: number | string;
  cogs: number | string;
  margin: number | string;
  margin_pct: number | string;
}
interface RawMarginCategoryRow {
  category_id: string | null;
  category_name: string;
  qty: number | string;
  revenue_ht: number | string;
  cogs: number | string;
  margin: number | string;
  margin_pct: number | string;
}
interface MarginPayload {
  timezone: string;
  summary: {
    revenue_ttc: number | string;
    revenue_ht: number | string;
    cogs: number | string;
    gross_margin: number | string;
    margin_pct: number | string;
    orders: number | string;
    products_without_cost: number | string;
  };
  by_product: RawMarginProductRow[];
  by_category: RawMarginCategoryRow[];
}

export function usePOSReportsMargin(period: ReportsPeriod) {
  return useQuery<POSReportsMargin>({
    queryKey: ['pos-reports-margin', period.startDate, period.endDate],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_pos_margin_v1', {
        p_start_date: period.startDate,
        p_end_date: period.endDate,
      });
      if (error) throw new Error(error.message);
      const p = data as unknown as MarginPayload;
      const s = p.summary;
      return {
        timezone: p.timezone,
        summary: {
          revenueTtc: Number(s.revenue_ttc),
          revenueHt: Number(s.revenue_ht),
          cogs: Number(s.cogs),
          grossMargin: Number(s.gross_margin),
          marginPct: Number(s.margin_pct),
          orders: Number(s.orders),
          productsWithoutCost: Number(s.products_without_cost),
        },
        byProduct: (p.by_product ?? []).map((r) => ({
          productId: r.product_id,
          productName: r.product_name,
          categoryName: r.category_name,
          qty: Number(r.qty),
          revenueHt: Number(r.revenue_ht),
          cogs: Number(r.cogs),
          margin: Number(r.margin),
          marginPct: Number(r.margin_pct),
        })),
        byCategory: (p.by_category ?? []).map((r) => ({
          categoryId: r.category_id,
          categoryName: r.category_name,
          qty: Number(r.qty),
          revenueHt: Number(r.revenue_ht),
          cogs: Number(r.cogs),
          margin: Number(r.margin),
          marginPct: Number(r.margin_pct),
        })),
      };
    },
    staleTime: 30_000,
  });
}
