import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ReportsPeriod } from './useReportsPeriod';
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


//
// Source of truth: server RPC `get_pos_order_type_category_mix_v1(p_start_date,
// p_end_date)`. Same order scope as the Overview, so the order-type revenue
// sums back to Overview revenue exactly. Two breakdowns:
//   * byOrderType — order-level (dine_in / take_out / delivery): revenue TTC,
//     order count, avg basket, revenue share.
//   * byCategory  — line-level per product category (excl. cancelled / promo-
//     gift lines): revenue, qty, share of category revenue.
