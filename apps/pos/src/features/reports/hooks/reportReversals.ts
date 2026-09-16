import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ReportsPeriod } from './useReportsPeriod';
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
