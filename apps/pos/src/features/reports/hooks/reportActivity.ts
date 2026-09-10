import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ReportsPeriod } from './useReportsPeriod';
export interface POSReportsTopProduct {
  product_id: string;
  product_name: string;
  qty: number;
  revenue: number;
}

interface TopProductRaw {
  product_id: string;
  product_name: string;
  qty: number | string;
  revenue: number | string;
  share_pct: number | string;
}
interface TopProductsPayload {
  timezone: string;
  total_revenue: number | string;
  products: TopProductRaw[];
}

export function usePOSReportsTopProducts(period: ReportsPeriod, limit = 25) {
  return useQuery<POSReportsTopProduct[]>({
    queryKey: ['pos-reports-top-products', period.startDate, period.endDate, limit],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_pos_top_products_v1', {
        p_start_date: period.startDate,
        p_end_date: period.endDate,
      });
      if (error) throw new Error(error.message);
      const p = data as unknown as TopProductsPayload;
      return (p.products ?? [])
        .map((r) => ({
          product_id: r.product_id,
          product_name: r.product_name,
          qty: Number(r.qty),
          revenue: Number(r.revenue),
        }))
        .slice(0, limit);
    },
    staleTime: 30_000,
  });
}


//
// Source of truth: server RPC `get_pos_activity_v1(p_start_date, p_end_date)`.
// One 'sale' event per in-scope order (same order scope as the Overview),
// newest first, capped server-side at the 500 most-recent events. Session
// open/close events were REMOVED here in Lot D — counting them as two separate
// events produced the misleading "Session Open N ≠ Session Close M" chips. The
// drawer lifecycle now has a dedicated home in the Sessions tab.

export type POSReportsEventKind = 'sale';

export interface POSReportsEvent {
  id: string;
  kind: POSReportsEventKind;
  reference: string;
  amount: number | null;
  at: string;
  label: string;
}

interface ActivityEventRaw {
  id: string;
  kind: POSReportsEventKind;
  reference: string;
  amount: number | string | null;
  at: string;
  label: string;
}
interface ActivityPayload {
  timezone: string;
  total_events: number | string;
  truncated: boolean;
  events: ActivityEventRaw[];
}

export function usePOSReportsActivity(period: ReportsPeriod) {
  return useQuery<POSReportsEvent[]>({
    queryKey: ['pos-reports-activity', period.startDate, period.endDate],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_pos_activity_v1', {
        p_start_date: period.startDate,
        p_end_date: period.endDate,
      });
      if (error) throw new Error(error.message);
      const p = data as unknown as ActivityPayload;
      return (p.events ?? []).map((e) => ({
        id: e.id,
        kind: e.kind,
        reference: e.reference,
        amount: e.amount == null ? null : Number(e.amount),
        at: e.at,
        label: e.label,
      }));
    },
    staleTime: 30_000,
  });
}


//
// Source of truth: server RPC `get_pos_margin_v1(p_start_date, p_end_date)`.
// Same order scope as the Overview (summary.revenue_ttc reconciles exactly);
// margin math is line-level HT (net of item discounts) against CURRENT
// products.cost_price — NOT a snapshot at sale time (Vague 3). Promo-gift
// lines count qty+COGS with revenue 0. Gated reports.financial.read.
