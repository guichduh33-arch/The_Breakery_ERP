// apps/backoffice/src/features/reports/hooks/useDiscountsLoyalty.ts
//
// Query hook pour `get_discounts_loyalty_v1` — l'argent consenti (quatre
// leviers) et le flux de points. Le TOTAL consenti, le taux et les parts se
// recalculent dans la page depuis summary/by_day — la bande ne peut pas
// diverger des ventilations. Le passif PROJETÉ des points se valorise avec
// REDEMPTION_RATE (packages/domain) côté client : le consenti, lui, vient de
// orders.loyalty_redemption_amount — le montant réellement décompté.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface DiscountsDayRow {
  date:             string;
  line_discount:    number;
  order_discount:   number;
  promotion:        number;
  redemption_value: number;
  points_issued:    number;
  points_burned:    number;
}

export interface PinDiscountRow {
  order_id:      string;
  order_number:  string;
  business_date: string;
  reason:        string | null;
  amount:        number;
  authorized_by: { id: string | null; name: string | null };
}

export interface PromotionRow {
  promotion_id: string;
  description:  string | null;
  applications: number;
  amount:       number;
}

export interface DiscountsLoyaltySummary {
  line_discount:         number;
  order_discount:        number;
  promotion:             number;
  redemption_value:      number;
  line_discount_prev:    number;
  order_discount_prev:   number;
  promotion_prev:        number;
  redemption_value_prev: number;
  gross_sales:           number;
  gross_sales_prev:      number;
  pin_count:             number;
  points_issued:         number;
  points_burned:         number;
}

export interface DiscountsLoyaltyData {
  period:        { start: string; end: string };
  period_prev:   { start: string; end: string };
  summary:       DiscountsLoyaltySummary;
  by_day:        DiscountsDayRow[];
  pin_discounts: PinDiscountRow[];
  by_promotion:  PromotionRow[];
}

export interface UseDiscountsLoyaltyParams {
  start: string;
  end:   string;
}

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

function toPeriod(v: unknown): { start: string; end: string } {
  const o = (v ?? {}) as Record<string, unknown>;
  return { start: toStr(o.start), end: toStr(o.end) };
}

export function useDiscountsLoyalty(params: UseDiscountsLoyaltyParams) {
  const { start, end } = params;
  return useQuery<DiscountsLoyaltyData, Error>({
    queryKey: ['discounts-loyalty', start, end],
    staleTime: 60_000,
    enabled: Boolean(start && end),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_discounts_loyalty_v1', {
        p_start_date: start,
        p_end_date:   end,
      });
      if (error) throw error as Error;

      const r       = (data ?? {}) as Record<string, unknown>;
      const summary = (r.summary ?? {}) as Record<string, unknown>;
      const byDay   = Array.isArray(r.by_day)        ? (r.by_day as unknown[])        : [];
      const pins    = Array.isArray(r.pin_discounts) ? (r.pin_discounts as unknown[]) : [];
      const promos  = Array.isArray(r.by_promotion)  ? (r.by_promotion as unknown[])  : [];

      return {
        period:      toPeriod(r.period),
        period_prev: toPeriod(r.period_prev),
        summary: {
          line_discount:         toNum(summary.line_discount),
          order_discount:        toNum(summary.order_discount),
          promotion:             toNum(summary.promotion),
          redemption_value:      toNum(summary.redemption_value),
          line_discount_prev:    toNum(summary.line_discount_prev),
          order_discount_prev:   toNum(summary.order_discount_prev),
          promotion_prev:        toNum(summary.promotion_prev),
          redemption_value_prev: toNum(summary.redemption_value_prev),
          gross_sales:           toNum(summary.gross_sales),
          gross_sales_prev:      toNum(summary.gross_sales_prev),
          pin_count:             toNum(summary.pin_count),
          points_issued:         toNum(summary.points_issued),
          points_burned:         toNum(summary.points_burned),
        },
        by_day: byDay.map((d) => {
          const o = (d ?? {}) as Record<string, unknown>;
          return {
            date:             toStr(o.date),
            line_discount:    toNum(o.line_discount),
            order_discount:   toNum(o.order_discount),
            promotion:        toNum(o.promotion),
            redemption_value: toNum(o.redemption_value),
            points_issued:    toNum(o.points_issued),
            points_burned:    toNum(o.points_burned),
          };
        }),
        pin_discounts: pins.map((p) => {
          const o = (p ?? {}) as Record<string, unknown>;
          const by = (o.authorized_by ?? {}) as Record<string, unknown>;
          return {
            order_id:      toStr(o.order_id),
            order_number:  toStr(o.order_number),
            business_date: toStr(o.business_date),
            reason:        o.reason != null ? toStr(o.reason) : null,
            amount:        toNum(o.amount),
            authorized_by: {
              id:   by.id   != null ? toStr(by.id)   : null,
              name: by.name != null ? toStr(by.name) : null,
            },
          };
        }),
        by_promotion: promos.map((p) => {
          const o = (p ?? {}) as Record<string, unknown>;
          return {
            promotion_id: toStr(o.promotion_id),
            description:  o.description != null ? toStr(o.description) : null,
            applications: toNum(o.applications),
            amount:       toNum(o.amount),
          };
        }),
      } satisfies DiscountsLoyaltyData;
    },
  });
}
