// apps/backoffice/src/features/reports/hooks/useSalesByCustomer.ts
//
// Query hook pour `get_sales_by_customer_v1` — le CA identifié (client attaché)
// vs l'anonyme, le détail par client avec fenêtre précédente, les nouveaux et
// le décrochage. Le seuil de décrochage est une CONSTANTE DOMAIN
// (CUSTOMER_CHURN_MIN_PREV_ORDERS) transmise en argument — la RPC reste
// générique, le code reste la source du seuil.
//
// Ce que la page DOIT dire (la RPC le porte, ça ne se devine pas des nombres) :
//   · identifié = CAPTURE, pas clientèle — l'anonyme est du comptoir sans carte ;
//   · le filtre de type ne restreint QUE l'identifié — l'anonyme n'a pas de type.

import { useQuery } from '@tanstack/react-query';
import { CUSTOMER_CHURN_MIN_PREV_ORDERS } from '@breakery/domain';
import { supabase } from '@/lib/supabase.js';

export interface CustomerSalesRow {
  customer_id:      string;
  name:             string;
  customer_type:    'retail' | 'b2b';
  loyalty_points:   number;
  order_count:      number;
  revenue:          number;
  last_order_date:  string;
  is_new:           boolean;
  revenue_prev:     number | null;
  order_count_prev: number | null;
}

export interface ChurnedCustomerRow {
  customer_id:      string;
  name:             string;
  customer_type:    'retail' | 'b2b';
  order_count_prev: number;
  revenue_prev:     number;
  last_order_date:  string;
}

export interface CustomerDayRow {
  date:       string;
  identified: number;
  anonymous:  number;
}

export interface SalesByCustomerSummary {
  identified_revenue:      number;
  identified_revenue_prev: number;
  identified_orders:       number;
  anonymous_revenue:       number;
  anonymous_revenue_prev:  number;
  anonymous_orders:        number;
  customer_count:          number;
  new_customer_count:      number;
}

export interface SalesByCustomerData {
  period:      { start: string; end: string };
  period_prev: { start: string; end: string };
  summary:     SalesByCustomerSummary;
  by_customer: CustomerSalesRow[];
  churned:     ChurnedCustomerRow[];
  by_day:      CustomerDayRow[];
}

export interface UseSalesByCustomerParams {
  start:         string;
  end:           string;
  customerType?: 'retail' | 'b2b' | null;
}

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

function toPeriod(v: unknown): { start: string; end: string } {
  const o = (v ?? {}) as Record<string, unknown>;
  return { start: toStr(o.start), end: toStr(o.end) };
}

function toType(v: unknown): 'retail' | 'b2b' {
  return v === 'b2b' ? 'b2b' : 'retail';
}

export function useSalesByCustomer(params: UseSalesByCustomerParams) {
  const { start, end, customerType } = params;
  return useQuery<SalesByCustomerData, Error>({
    queryKey: ['sales-by-customer', start, end, customerType ?? null],
    staleTime: 60_000,
    enabled: Boolean(start && end),
    queryFn: async () => {
      const args: {
        p_start_date: string; p_end_date: string;
        p_customer_type?: string; p_churn_min_orders: number;
      } = {
        p_start_date:       start,
        p_end_date:         end,
        p_churn_min_orders: CUSTOMER_CHURN_MIN_PREV_ORDERS,
      };
      if (customerType) args.p_customer_type = customerType;

      const { data, error } = await supabase.rpc('get_sales_by_customer_v1', args);
      if (error) throw error as Error;

      const r       = (data ?? {}) as Record<string, unknown>;
      const summary = (r.summary ?? {}) as Record<string, unknown>;
      const rows    = Array.isArray(r.by_customer) ? (r.by_customer as unknown[]) : [];
      const churned = Array.isArray(r.churned)     ? (r.churned as unknown[])     : [];
      const byDay   = Array.isArray(r.by_day)      ? (r.by_day as unknown[])      : [];

      return {
        period:      toPeriod(r.period),
        period_prev: toPeriod(r.period_prev),
        summary: {
          identified_revenue:      toNum(summary.identified_revenue),
          identified_revenue_prev: toNum(summary.identified_revenue_prev),
          identified_orders:       toNum(summary.identified_orders),
          anonymous_revenue:       toNum(summary.anonymous_revenue),
          anonymous_revenue_prev:  toNum(summary.anonymous_revenue_prev),
          anonymous_orders:        toNum(summary.anonymous_orders),
          customer_count:          toNum(summary.customer_count),
          new_customer_count:      toNum(summary.new_customer_count),
        },
        by_customer: rows.map((c) => {
          const o = (c ?? {}) as Record<string, unknown>;
          return {
            customer_id:      toStr(o.customer_id),
            name:             toStr(o.name),
            customer_type:    toType(o.customer_type),
            loyalty_points:   toNum(o.loyalty_points),
            order_count:      toNum(o.order_count),
            revenue:          toNum(o.revenue),
            last_order_date:  toStr(o.last_order_date),
            is_new:           o.is_new === true,
            revenue_prev:     toNumOrNull(o.revenue_prev),
            order_count_prev: toNumOrNull(o.order_count_prev),
          };
        }),
        churned: churned.map((c) => {
          const o = (c ?? {}) as Record<string, unknown>;
          return {
            customer_id:      toStr(o.customer_id),
            name:             toStr(o.name),
            customer_type:    toType(o.customer_type),
            order_count_prev: toNum(o.order_count_prev),
            revenue_prev:     toNum(o.revenue_prev),
            last_order_date:  toStr(o.last_order_date),
          };
        }),
        by_day: byDay.map((d) => {
          const o = (d ?? {}) as Record<string, unknown>;
          return {
            date:       toStr(o.date),
            identified: toNum(o.identified),
            anonymous:  toNum(o.anonymous),
          };
        }),
      } satisfies SalesByCustomerData;
    },
  });
}
