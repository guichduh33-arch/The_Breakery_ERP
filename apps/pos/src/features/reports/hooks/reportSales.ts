import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ReportsPeriod } from './useReportsPeriod';
export interface POSReportsSalesHour {
  hour: number;
  /** Revenue (TTC) rung up in this WITA hour. */
  revenue: number;
  /** Number of tickets (orders) in this WITA hour. */
  tickets: number;
}

export interface POSReportsSalesDay {
  /** WITA business date, `YYYY-MM-DD`. */
  date: string;
  /** Revenue (TTC) rung up on this day. */
  revenue: number;
  /** Number of tickets (orders) on this day. */
  tickets: number;
}

export interface POSReportsOverview {
  /** Revenue TTC (tax-inclusive). */
  revenue: number;
  orders: number;
  tax: number;
  /** Total units sold (line-level, excl. cancelled / promo-gift). */
  itemsSold: number;
  avgBasket: number;
  salesByHour: POSReportsSalesHour[];
  /** Contiguous per-day series over the range (zero-filled gaps). */
  byDay: POSReportsSalesDay[];
  timezone: string;
}

interface OverviewPayload {
  revenue: number | string;
  orders: number | string;
  tax: number | string;
  items_sold: number | string;
  avg_basket: number | string;
  timezone: string;
  sales_by_hour: { hour: number; revenue: number | string; tickets: number | string }[];
  by_day: { date: string; revenue: number | string; tickets: number | string }[];
}

export function usePOSReportsOverview(period: ReportsPeriod) {
  return useQuery<POSReportsOverview>({
    // Keyed on the WITA business dates the RPC actually consumes.
    queryKey: ['pos-reports-overview', period.startDate, period.endDate],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_pos_sales_overview_v1', {
        p_start_date: period.startDate,
        p_end_date: period.endDate,
      });
      if (error) throw new Error(error.message);
      const p = data as unknown as OverviewPayload;
      return {
        revenue: Number(p.revenue),
        orders: Number(p.orders),
        tax: Number(p.tax),
        itemsSold: Number(p.items_sold ?? 0),
        avgBasket: Number(p.avg_basket),
        timezone: p.timezone,
        salesByHour: (p.sales_by_hour ?? []).map((h) => ({
          hour: h.hour,
          revenue: Number(h.revenue),
          tickets: Number(h.tickets),
        })),
        byDay: (p.by_day ?? []).map((d) => ({
          date: d.date,
          revenue: Number(d.revenue),
          tickets: Number(d.tickets),
        })),
      };
    },
    staleTime: 30_000,
  });
}


//
// Source of truth: server RPC `get_pos_payment_breakdown_v1(p_start_date,
// p_end_date)`. Same order scope as the Overview (paid + completed retail,
// non-B2B, non-historical, no test-product line, WITA date bucketing), so the
// tendered total reconciles with Overview revenue — except for outstanding
// `completed` orders, where tenders < order total (this reports the real
// amount cashed in, not recognised revenue).

export interface POSReportsPaymentMethod {
  /** Payment tender code: cash / card / qris / edc / transfer / store_credit / … */
  method: string;
  /** Amount tendered via this method (net of change given). */
  amount: number;
  /** Number of tenders (payment rows) — an order may split across methods. */
  tenders: number;
  /** Share of the tendered total, 0–100. */
  share_pct: number;
}

export interface POSReportsPayments {
  /** Total amount actually tendered across all methods. */
  totalAmount: number;
  /** Distinct orders in scope. */
  totalOrders: number;
  /** Total tender rows (≥ orders when split tenders exist). */
  totalTenders: number;
  byMethod: POSReportsPaymentMethod[];
  timezone: string;
}

interface PaymentsPayload {
  total_amount: number | string;
  total_orders: number | string;
  total_tenders: number | string;
  timezone: string;
  by_method: {
    method: string;
    amount: number | string;
    tenders: number | string;
    share_pct: number | string;
  }[];
}

export function usePOSReportsPayments(period: ReportsPeriod) {
  return useQuery<POSReportsPayments>({
    queryKey: ['pos-reports-payments', period.startDate, period.endDate],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_pos_payment_breakdown_v1', {
        p_start_date: period.startDate,
        p_end_date: period.endDate,
      });
      if (error) throw new Error(error.message);
      const p = data as unknown as PaymentsPayload;
      return {
        totalAmount: Number(p.total_amount),
        totalOrders: Number(p.total_orders),
        totalTenders: Number(p.total_tenders),
        timezone: p.timezone,
        byMethod: (p.by_method ?? []).map((m) => ({
          method: m.method,
          amount: Number(m.amount),
          tenders: Number(m.tenders),
          share_pct: Number(m.share_pct),
        })),
      };
    },
    staleTime: 30_000,
  });
}


//
// Source of truth: server RPC `get_pos_voids_refunds_v1(p_start_date,
// p_end_date)`. Same order scope as the Overview (non-B2B, non-historical, no
// test-product line, WITA date bucketing). Two blocks:
//   * reversals   — full voids + partial refunds (refunds table) + pre-payment
//     item cancellations, split by reason / operator / authorizing manager and
//     tagged before/after kitchen (sent_to_kitchen_at).
//   * discounts   — applied discounts (orders.discount_*) by type & authorizing
//     operator; a "comp" is a 100% discount (percentage ≥ 100).
