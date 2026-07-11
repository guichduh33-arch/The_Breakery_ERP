// apps/pos/src/features/reports/hooks/usePOSReports.ts
//
// Session 14 — Phase 2.D — Aggregate POS reports for a period.
//
// One hook per surface to keep query keys narrow and avoid over-fetching.
// Every surface is now backed by a dedicated read-only server RPC
// (`get_pos_*_v1`) that does its own WITA-timezone date bucketing and shares
// one canonical order scope, so the tabs reconcile with each other:
//   - usePOSReportsOverview      → get_pos_sales_overview_v1
//   - usePOSReportsPayments      → get_pos_payment_breakdown_v1
//   - usePOSReportsVoidsRefunds  → get_pos_voids_refunds_v1
//   - usePOSReportsSessions      → get_pos_sessions_report_v1
//   - usePOSReportsMix           → get_pos_order_type_category_mix_v1
//   - usePOSReportsTopProducts   → get_pos_top_products_v1
//   - usePOSReportsActivity      → get_pos_activity_v1

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

// ─── Sessions / Z-report ────────────────────────────────────────────────────
//
// Source of truth: server RPC `get_pos_sessions_report_v1(p_start_date,
// p_end_date)`. One row per pos_session (drawer lifecycle), anchored on its
// WITA opening day — this REPLACES the Activity tab's confusing "Session Open N
// ≠ Session Close M" counters with a single lifecycle count. Each row carries:
//   * live drawer aggregates (sales / order_count / refunds / voids)
//   * the FROZEN 3-way reconciliation (cash / QRIS / card, expected·counted·
//     variance) read from the shift.close audit metadata — same stable source
//     as the BO cashier-variance report. Open sessions expose null volets
//     (reconciliation pending); pre-S67 sessions may lack QRIS/card (null).

export interface POSReportsReconVolet {
  /** Expected amount for this tender at close (null until the volet is counted). */
  expected: number | null;
  /** Counted amount at close (null while the drawer is open / not counted). */
  counted: number | null;
  /** counted − expected (null while open / not counted). */
  variance: number | null;
}

export interface POSReportsSession {
  sessionId: string;
  status: 'open' | 'closed';
  cashierId: string | null;
  cashierName: string;
  closedById: string | null;
  closedByName: string | null;
  openedAt: string;
  closedAt: string | null;
  openingCash: number;
  salesTotal: number;
  orderCount: number;
  refundsTotal: number;
  voidsTotal: number;
  cash: POSReportsReconVolet;
  qris: POSReportsReconVolet;
  card: POSReportsReconVolet;
  openingNotes: string | null;
  closingNotes: string | null;
  /** A manager PIN-approved the (large) closing variance. */
  varianceApproved: boolean;
}

export interface POSReportsSessionsSummary {
  totalSessions: number;
  openCount: number;
  closedCount: number;
  salesTotal: number;
  voidsTotal: number;
  cashVarianceTotal: number;
  cashShortCount: number;
  cashOverCount: number;
}

export interface POSReportsSessions {
  summary: POSReportsSessionsSummary;
  sessions: POSReportsSession[];
  timezone: string;
}

interface RawVolet {
  expected: number | string | null;
  counted: number | string | null;
  variance: number | string | null;
}

interface RawSession {
  session_id: string;
  status: 'open' | 'closed';
  cashier_id: string | null;
  cashier_name: string;
  closed_by_id: string | null;
  closed_by_name: string | null;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number | string;
  sales_total: number | string;
  order_count: number | string;
  refunds_total: number | string;
  voids_total: number | string;
  cash: RawVolet;
  qris: RawVolet;
  card: RawVolet;
  opening_notes: string | null;
  closing_notes: string | null;
  variance_approved: boolean;
}

interface SessionsPayload {
  timezone: string;
  summary: {
    total_sessions: number | string;
    open_count: number | string;
    closed_count: number | string;
    sales_total: number | string;
    voids_total: number | string;
    cash_variance_total: number | string;
    cash_short_count: number | string;
    cash_over_count: number | string;
  };
  sessions: RawSession[];
}

/** Coerce to number, preserving null (Number(null) === 0 would corrupt nulls). */
function numOrNull(v: number | string | null): number | null {
  return v === null ? null : Number(v);
}

function mapVolet(v: RawVolet): POSReportsReconVolet {
  return {
    expected: numOrNull(v.expected),
    counted: numOrNull(v.counted),
    variance: numOrNull(v.variance),
  };
}

export function usePOSReportsSessions(period: ReportsPeriod) {
  return useQuery<POSReportsSessions>({
    queryKey: ['pos-reports-sessions', period.startDate, period.endDate],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_pos_sessions_report_v1', {
        p_start_date: period.startDate,
        p_end_date: period.endDate,
      });
      if (error) throw new Error(error.message);
      const p = data as unknown as SessionsPayload;
      const s = p.summary;
      return {
        timezone: p.timezone,
        summary: {
          totalSessions: Number(s.total_sessions),
          openCount: Number(s.open_count),
          closedCount: Number(s.closed_count),
          salesTotal: Number(s.sales_total),
          voidsTotal: Number(s.voids_total),
          cashVarianceTotal: Number(s.cash_variance_total),
          cashShortCount: Number(s.cash_short_count),
          cashOverCount: Number(s.cash_over_count),
        },
        sessions: (p.sessions ?? []).map((r) => ({
          sessionId: r.session_id,
          status: r.status,
          cashierId: r.cashier_id,
          cashierName: r.cashier_name,
          closedById: r.closed_by_id,
          closedByName: r.closed_by_name,
          openedAt: r.opened_at,
          closedAt: r.closed_at,
          openingCash: Number(r.opening_cash),
          salesTotal: Number(r.sales_total),
          orderCount: Number(r.order_count),
          refundsTotal: Number(r.refunds_total),
          voidsTotal: Number(r.voids_total),
          cash: mapVolet(r.cash),
          qris: mapVolet(r.qris),
          card: mapVolet(r.card),
          openingNotes: r.opening_notes,
          closingNotes: r.closing_notes,
          varianceApproved: r.variance_approved,
        })),
      };
    },
    staleTime: 30_000,
  });
}

// ─── Order-type mix + category performance ──────────────────────────────────
//
// Source of truth: server RPC `get_pos_order_type_category_mix_v1(p_start_date,
// p_end_date)`. Same order scope as the Overview, so the order-type revenue
// sums back to Overview revenue exactly. Two breakdowns:
//   * byOrderType — order-level (dine_in / take_out / delivery): revenue TTC,
//     order count, avg basket, revenue share.
//   * byCategory  — line-level per product category (excl. cancelled / promo-
//     gift lines): revenue, qty, share of category revenue.

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

// ─── Products ─────────────────────────────────────────────────────────────
//
// Source of truth: server RPC `get_pos_top_products_v1(p_start_date, p_end_date)`.
// Line-level aggregation over the SAME order scope as the Overview / Mix
// (paid + completed retail, non-B2B, non-historical, no test-product line, WITA
// date bucketing; excludes cancelled + promo-gift lines), so the product
// revenue reconciles with the Mix by-category revenue. The RPC returns all
// products sorted by revenue DESC; the caller slices the top-N it wants.

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

// ─── Activity ─────────────────────────────────────────────────────────────
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
