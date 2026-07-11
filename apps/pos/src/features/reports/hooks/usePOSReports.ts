// apps/pos/src/features/reports/hooks/usePOSReports.ts
//
// Session 14 — Phase 2.D — Aggregate POS reports for a period.
//
// One hook per surface to keep query keys narrow and avoid over-fetching:
//   - usePOSReportsOverview  → revenue, orders, avg basket, tax, sales-by-hour
//   - usePOSReportsProducts  → top products
//   - usePOSReportsActivity  → event timeline (sales + session opens/closes)
//
// All queries use Supabase via the existing `supabase` client. No new
// migrations or RPCs needed — these are read-only against existing tables.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ReportsPeriod } from './useReportsPeriod';

// ─── Overview ─────────────────────────────────────────────────────────────
//
// Source of truth: server RPC `get_pos_sales_overview_v1(p_start_date, p_end_date)`
// (shared with the back-office). The RPC does all WITA-timezone date + hour
// bucketing, excludes B2B / historical imports / test-product orders, and
// includes paid + completed retail orders. Revenue is TTC; tax reported apart.

export interface POSReportsSalesHour {
  hour: number;
  /** Revenue (TTC) rung up in this WITA hour. */
  revenue: number;
  /** Number of tickets (orders) in this WITA hour. */
  tickets: number;
}

export interface POSReportsOverview {
  /** Revenue TTC (tax-inclusive). */
  revenue: number;
  orders: number;
  tax: number;
  avgBasket: number;
  salesByHour: POSReportsSalesHour[];
  timezone: string;
}

interface OverviewPayload {
  revenue: number | string;
  orders: number | string;
  tax: number | string;
  avg_basket: number | string;
  timezone: string;
  sales_by_hour: { hour: number; revenue: number | string; tickets: number | string }[];
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
        avgBasket: Number(p.avg_basket),
        timezone: p.timezone,
        salesByHour: (p.sales_by_hour ?? []).map((h) => ({
          hour: h.hour,
          revenue: Number(h.revenue),
          tickets: Number(h.tickets),
        })),
      };
    },
    staleTime: 30_000,
  });
}

// ─── Payments ─────────────────────────────────────────────────────────────
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

// ─── Voids / Refunds / Discounts ────────────────────────────────────────────
//
// Source of truth: server RPC `get_pos_voids_refunds_v1(p_start_date,
// p_end_date)`. Same order scope as the Overview (non-B2B, non-historical, no
// test-product line, WITA date bucketing). Two blocks:
//   * reversals   — full voids + partial refunds (refunds table) + pre-payment
//     item cancellations, split by reason / operator / authorizing manager and
//     tagged before/after kitchen (sent_to_kitchen_at).
//   * discounts   — applied discounts (orders.discount_*) by type & authorizing
//     operator; a "comp" is a 100% discount (percentage ≥ 100).

export interface POSReportsBreakdownRow {
  operator_id: string | null;
  operator_name: string | null;
  count: number;
  amount: number;
}

export interface POSReportsReasonRow {
  reason: string;
  count: number;
  amount: number;
}

export interface POSReportsReversals {
  voids: {
    count: number;
    amount: number;
    taxRefunded: number;
    afterKitchenCount: number;
    beforeKitchenCount: number;
  };
  refunds: { count: number; amount: number; taxRefunded: number };
  itemCancellations: {
    count: number;
    afterKitchenCount: number;
    beforeKitchenCount: number;
  };
  byReason: POSReportsReasonRow[];
  byOperator: POSReportsBreakdownRow[];
  byAuthorizer: POSReportsBreakdownRow[];
}

export interface POSReportsDiscountTypeRow {
  type: string;
  count: number;
  amount: number;
}

export interface POSReportsDiscounts {
  totalAmount: number;
  orderCount: number;
  compCount: number;
  byType: POSReportsDiscountTypeRow[];
  byOperator: POSReportsBreakdownRow[];
}

export interface POSReportsVoidsRefunds {
  reversals: POSReportsReversals;
  discounts: POSReportsDiscounts;
  timezone: string;
}

interface RawBreakdownRow {
  operator_id: string | null;
  operator_name: string | null;
  count: number | string;
  amount: number | string;
}
interface RawReasonRow { reason: string; count: number | string; amount: number | string }
interface RawDiscountTypeRow { type: string; count: number | string; amount: number | string }

interface VoidsRefundsPayload {
  timezone: string;
  reversals: {
    voids: {
      count: number | string;
      amount: number | string;
      tax_refunded: number | string;
      after_kitchen_count: number | string;
      before_kitchen_count: number | string;
    };
    refunds: { count: number | string; amount: number | string; tax_refunded: number | string };
    item_cancellations: {
      count: number | string;
      after_kitchen_count: number | string;
      before_kitchen_count: number | string;
    };
    by_reason: RawReasonRow[];
    by_operator: RawBreakdownRow[];
    by_authorizer: RawBreakdownRow[];
  };
  discounts: {
    total_amount: number | string;
    order_count: number | string;
    comp_count: number | string;
    by_type: RawDiscountTypeRow[];
    by_operator: RawBreakdownRow[];
  };
}

function mapBreakdown(rows: RawBreakdownRow[] | undefined): POSReportsBreakdownRow[] {
  return (rows ?? []).map((r) => ({
    operator_id: r.operator_id,
    operator_name: r.operator_name,
    count: Number(r.count),
    amount: Number(r.amount),
  }));
}

export function usePOSReportsVoidsRefunds(period: ReportsPeriod) {
  return useQuery<POSReportsVoidsRefunds>({
    queryKey: ['pos-reports-voids-refunds', period.startDate, period.endDate],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_pos_voids_refunds_v1', {
        p_start_date: period.startDate,
        p_end_date: period.endDate,
      });
      if (error) throw new Error(error.message);
      const p = data as unknown as VoidsRefundsPayload;
      const rv = p.reversals;
      const ds = p.discounts;
      return {
        timezone: p.timezone,
        reversals: {
          voids: {
            count: Number(rv.voids.count),
            amount: Number(rv.voids.amount),
            taxRefunded: Number(rv.voids.tax_refunded),
            afterKitchenCount: Number(rv.voids.after_kitchen_count),
            beforeKitchenCount: Number(rv.voids.before_kitchen_count),
          },
          refunds: {
            count: Number(rv.refunds.count),
            amount: Number(rv.refunds.amount),
            taxRefunded: Number(rv.refunds.tax_refunded),
          },
          itemCancellations: {
            count: Number(rv.item_cancellations.count),
            afterKitchenCount: Number(rv.item_cancellations.after_kitchen_count),
            beforeKitchenCount: Number(rv.item_cancellations.before_kitchen_count),
          },
          byReason: (rv.by_reason ?? []).map((r) => ({
            reason: r.reason,
            count: Number(r.count),
            amount: Number(r.amount),
          })),
          byOperator: mapBreakdown(rv.by_operator),
          byAuthorizer: mapBreakdown(rv.by_authorizer),
        },
        discounts: {
          totalAmount: Number(ds.total_amount),
          orderCount: Number(ds.order_count),
          compCount: Number(ds.comp_count),
          byType: (ds.by_type ?? []).map((r) => ({
            type: r.type,
            count: Number(r.count),
            amount: Number(r.amount),
          })),
          byOperator: mapBreakdown(ds.by_operator),
        },
      };
    },
    staleTime: 30_000,
  });
}

// ─── Products ─────────────────────────────────────────────────────────────

export interface POSReportsTopProduct {
  product_id: string;
  product_name: string;
  qty: number;
  revenue: number;
}

interface ProductRow {
  product_id: string;
  name_snapshot: string;
  quantity: number;
  line_total: number;
  is_cancelled: boolean;
  order: { status: 'paid' | 'voided' | 'draft'; paid_at: string | null } | null;
}

export function usePOSReportsTopProducts(period: ReportsPeriod, limit = 25) {
  return useQuery<POSReportsTopProduct[]>({
    queryKey: ['pos-reports-top-products', period.start, period.end, limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_items')
        .select(
          'product_id, name_snapshot, quantity, line_total, is_cancelled, order:orders!inner(status, paid_at)',
        )
        .eq('is_cancelled', false)
        .eq('order.status', 'paid')
        .gte('order.paid_at', period.start)
        .lt('order.paid_at', period.end);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as ProductRow[];
      const agg = new Map<string, POSReportsTopProduct>();
      for (const r of rows) {
        const existing = agg.get(r.product_id);
        if (existing) {
          existing.qty += Number(r.quantity);
          existing.revenue += Number(r.line_total);
        } else {
          agg.set(r.product_id, {
            product_id: r.product_id,
            product_name: r.name_snapshot,
            qty: Number(r.quantity),
            revenue: Number(r.line_total),
          });
        }
      }
      return Array.from(agg.values())
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, limit);
    },
    staleTime: 30_000,
  });
}

// ─── Activity ─────────────────────────────────────────────────────────────

export type POSReportsEventKind = 'sale' | 'session_open' | 'session_close';

export interface POSReportsEvent {
  id: string;
  kind: POSReportsEventKind;
  reference: string;
  amount: number | null;
  at: string;
  label: string;
}

interface OrderActivityRow {
  id: string;
  order_number: string;
  total: number;
  paid_at: string | null;
}

interface SessionActivityRow {
  id: string;
  opened_at: string;
  closed_at: string | null;
}

export function usePOSReportsActivity(period: ReportsPeriod) {
  return useQuery<POSReportsEvent[]>({
    queryKey: ['pos-reports-activity', period.start, period.end],
    queryFn: async () => {
      const [{ data: orderRows, error: orderErr }, { data: openSessions, error: openErr }, { data: closeSessions, error: closeErr }] =
        await Promise.all([
          supabase
            .from('orders')
            .select('id, order_number, total, paid_at')
            .eq('status', 'paid')
            .gte('paid_at', period.start)
            .lt('paid_at', period.end),
          supabase
            .from('pos_sessions')
            .select('id, opened_at, closed_at')
            .gte('opened_at', period.start)
            .lt('opened_at', period.end),
          supabase
            .from('pos_sessions')
            .select('id, opened_at, closed_at')
            .not('closed_at', 'is', null)
            .gte('closed_at', period.start)
            .lt('closed_at', period.end),
        ]);
      if (orderErr) throw new Error(orderErr.message);
      if (openErr) throw new Error(openErr.message);
      if (closeErr) throw new Error(closeErr.message);

      const events: POSReportsEvent[] = [];
      for (const r of (orderRows ?? []) as unknown as OrderActivityRow[]) {
        if (!r.paid_at) continue;
        events.push({
          id: `order-${r.id}`,
          kind: 'sale',
          reference: r.order_number,
          amount: Number(r.total),
          at: r.paid_at,
          label: 'Sale completed',
        });
      }
      for (const r of (openSessions ?? []) as unknown as SessionActivityRow[]) {
        events.push({
          id: `open-${r.id}`,
          kind: 'session_open',
          reference: `SHF-${r.id.slice(0, 6).toUpperCase()}`,
          amount: null,
          at: r.opened_at,
          label: 'Session opened',
        });
      }
      for (const r of (closeSessions ?? []) as unknown as SessionActivityRow[]) {
        if (!r.closed_at) continue;
        events.push({
          id: `close-${r.id}`,
          kind: 'session_close',
          reference: `SHF-${r.id.slice(0, 6).toUpperCase()}`,
          amount: null,
          at: r.closed_at,
          label: 'Session closed',
        });
      }
      events.sort((a, b) => (a.at < b.at ? 1 : -1));
      return events;
    },
    staleTime: 30_000,
  });
}
