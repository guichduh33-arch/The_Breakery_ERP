// apps/backoffice/src/features/reports/hooks/usePurchaseCogsBreakdown.ts
//
// Wraps get_purchase_cogs_breakdown_v1 — material purchasing spend (COGS proxy)
// ventilated by product category + by day. Gate reports.inventory.read.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface CogsCategoryRow {
  category_id: string;
  name:        string;
  total:       number;
  qty:         number;
  share_pct:   number;
}

export interface CostByDayPoint {
  date:  string;
  total: number;
}

export interface PurchaseCogsBreakdown {
  period:      { start: string; end: string };
  summary:     { total: number; line_count: number; category_count: number };
  by_category: CogsCategoryRow[];
  by_day:      CostByDayPoint[];
}

export interface UsePurchaseCogsParams {
  start:       string;
  end:         string;
  categoryId?: string | null;
}

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function usePurchaseCogsBreakdown(params: UsePurchaseCogsParams) {
  return useQuery<PurchaseCogsBreakdown, Error>({
    queryKey: ['reports', 'purchase-cogs', params.start, params.end, params.categoryId ?? null],
    staleTime: 60_000,
    enabled: Boolean(params.start && params.end),
    queryFn: async () => {
      const args: { p_date_start: string; p_date_end: string; p_category_id?: string } = {
        p_date_start: params.start,
        p_date_end:   params.end,
      };
      if (params.categoryId) args.p_category_id = params.categoryId;

      const { data, error } = await supabase.rpc('get_purchase_cogs_breakdown_v1', args);
      if (error) throw error as Error;

      const r = (data ?? {}) as Record<string, unknown>;
      const period  = (r.period  ?? {}) as Record<string, unknown>;
      const summary = (r.summary ?? {}) as Record<string, unknown>;
      const cats    = Array.isArray(r.by_category) ? (r.by_category as unknown[]) : [];
      const days    = Array.isArray(r.by_day)      ? (r.by_day as unknown[])      : [];

      return {
        period: {
          start: String(period.start ?? params.start),
          end:   String(period.end   ?? params.end),
        },
        summary: {
          total:          toNum(summary.total),
          line_count:     toNum(summary.line_count),
          category_count: toNum(summary.category_count),
        },
        by_category: cats.map((c) => {
          const o = (c ?? {}) as Record<string, unknown>;
          return {
            category_id: String(o.category_id ?? ''),
            name:        String(o.name ?? 'Uncategorized'),
            total:       toNum(o.total),
            qty:         toNum(o.qty),
            share_pct:   toNum(o.share_pct),
          };
        }),
        by_day: days.map((d) => {
          const o = (d ?? {}) as Record<string, unknown>;
          return { date: String(o.date ?? ''), total: toNum(o.total) };
        }),
      } satisfies PurchaseCogsBreakdown;
    },
  });
}
