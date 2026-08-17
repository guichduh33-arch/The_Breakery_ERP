// apps/backoffice/src/features/reports/hooks/useComboSales.ts
//
// Query hook pour `get_combo_sales_v1` — les ventes de combos. Une ligne
// combo = combo_components non NULL (pricing serveur ADR-017) ; le prix
// affiché est le prix effectif TOTAL payé (arbitrage — pas de ventilation
// base/surcharges). L'uplift (panier avec vs sans combo) et la part du CA se
// recalculent dans la page depuis les chiffres servis.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface ComboRow {
  product_id: string;
  name:       string;
  qty:        number;
  revenue:    number;
  avg_price:  number;
}

export interface ComboDayRow {
  date:    string;
  revenue: number;
  qty:     number;
}

export interface ComponentPickRow {
  product_id: string;
  name:       string;
  qty:        number;
}

export interface ComboSalesSummary {
  combo_revenue:      number;
  combo_revenue_prev: number;
  combo_qty:          number;
  combo_qty_prev:     number;
  combo_orders:       number;
  gross_sales:        number;
  avg_ticket_with:    number | null;
  avg_ticket_without: number | null;
}

export interface ComboSalesData {
  period:          { start: string; end: string };
  period_prev:     { start: string; end: string };
  summary:         ComboSalesSummary;
  by_day:          ComboDayRow[];
  by_combo:        ComboRow[];
  component_picks: ComponentPickRow[];
}

export interface UseComboSalesParams {
  start: string;
  end:   string;
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

export function useComboSales(params: UseComboSalesParams) {
  const { start, end } = params;
  return useQuery<ComboSalesData, Error>({
    queryKey: ['combo-sales', start, end],
    staleTime: 60_000,
    enabled: Boolean(start && end),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_combo_sales_v1', {
        p_start_date: start,
        p_end_date:   end,
      });
      if (error) throw error as Error;

      const r       = (data ?? {}) as Record<string, unknown>;
      const summary = (r.summary ?? {}) as Record<string, unknown>;
      const days    = Array.isArray(r.by_day)          ? (r.by_day as unknown[])          : [];
      const combos  = Array.isArray(r.by_combo)        ? (r.by_combo as unknown[])        : [];
      const picks   = Array.isArray(r.component_picks) ? (r.component_picks as unknown[]) : [];

      return {
        period:      toPeriod(r.period),
        period_prev: toPeriod(r.period_prev),
        summary: {
          combo_revenue:      toNum(summary.combo_revenue),
          combo_revenue_prev: toNum(summary.combo_revenue_prev),
          combo_qty:          toNum(summary.combo_qty),
          combo_qty_prev:     toNum(summary.combo_qty_prev),
          combo_orders:       toNum(summary.combo_orders),
          gross_sales:        toNum(summary.gross_sales),
          avg_ticket_with:    toNumOrNull(summary.avg_ticket_with),
          avg_ticket_without: toNumOrNull(summary.avg_ticket_without),
        },
        by_day: days.map((d) => {
          const o = (d ?? {}) as Record<string, unknown>;
          return { date: toStr(o.date), revenue: toNum(o.revenue), qty: toNum(o.qty) };
        }),
        by_combo: combos.map((c) => {
          const o = (c ?? {}) as Record<string, unknown>;
          return {
            product_id: toStr(o.product_id),
            name:       toStr(o.name),
            qty:        toNum(o.qty),
            revenue:    toNum(o.revenue),
            avg_price:  toNum(o.avg_price),
          };
        }),
        component_picks: picks.map((p) => {
          const o = (p ?? {}) as Record<string, unknown>;
          return {
            product_id: toStr(o.product_id),
            name:       toStr(o.name),
            qty:        toNum(o.qty),
          };
        }),
      } satisfies ComboSalesData;
    },
  });
}
