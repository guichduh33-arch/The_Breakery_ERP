// apps/backoffice/src/features/reports/hooks/useSalesByOrigin.ts
//
// Query hook pour `get_sales_by_origin_v1` — les ventes par origine de
// commande (P comptoir / T1-T2 tablettes / BO back-office, le B2B sort
// structurellement en BO). L'origine est lue dans le numéro source-codé
// (2026-08-16) ; les commandes pré-numérotation sont EXCLUES (arbitrage) —
// le rapport ne dit rien d'avant le cutover et la page l'affiche en réserve.
// `by_day` arrive en format LONG {date, origin, …} : la page pivote.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface OriginRow {
  origin:         string;
  orders:         number;
  revenue:        number;
  avg_ticket:     number;
  discount_total: number;
  revenue_prev:   number;
  orders_prev:    number;
}

export interface OriginDayRow {
  date:    string;
  origin:  string;
  revenue: number;
  orders:  number;
}

export interface SalesByOriginSummary {
  total_revenue:      number;
  total_orders:       number;
  total_revenue_prev: number;
  total_orders_prev:  number;
}

export interface SalesByOriginData {
  period:      { start: string; end: string };
  period_prev: { start: string; end: string };
  summary:     SalesByOriginSummary;
  by_origin:   OriginRow[];
  by_day:      OriginDayRow[];
}

export interface UseSalesByOriginParams {
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

export function useSalesByOrigin(params: UseSalesByOriginParams) {
  const { start, end } = params;
  return useQuery<SalesByOriginData, Error>({
    queryKey: ['sales-by-origin', start, end],
    staleTime: 60_000,
    enabled: Boolean(start && end),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_sales_by_origin_v1', {
        p_start_date: start,
        p_end_date:   end,
      });
      if (error) throw error as Error;

      const r       = (data ?? {}) as Record<string, unknown>;
      const summary = (r.summary ?? {}) as Record<string, unknown>;
      const origins = Array.isArray(r.by_origin) ? (r.by_origin as unknown[]) : [];
      const days    = Array.isArray(r.by_day)    ? (r.by_day as unknown[])    : [];

      return {
        period:      toPeriod(r.period),
        period_prev: toPeriod(r.period_prev),
        summary: {
          total_revenue:      toNum(summary.total_revenue),
          total_orders:       toNum(summary.total_orders),
          total_revenue_prev: toNum(summary.total_revenue_prev),
          total_orders_prev:  toNum(summary.total_orders_prev),
        },
        by_origin: origins.map((b) => {
          const o = (b ?? {}) as Record<string, unknown>;
          return {
            origin:         toStr(o.origin),
            orders:         toNum(o.orders),
            revenue:        toNum(o.revenue),
            avg_ticket:     toNum(o.avg_ticket),
            discount_total: toNum(o.discount_total),
            revenue_prev:   toNum(o.revenue_prev),
            orders_prev:    toNum(o.orders_prev),
          };
        }),
        by_day: days.map((d) => {
          const o = (d ?? {}) as Record<string, unknown>;
          return {
            date:    toStr(o.date),
            origin:  toStr(o.origin),
            revenue: toNum(o.revenue),
            orders:  toNum(o.orders),
          };
        }),
      } satisfies SalesByOriginData;
    },
  });
}
