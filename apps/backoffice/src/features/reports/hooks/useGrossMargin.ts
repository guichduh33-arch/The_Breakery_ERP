// apps/backoffice/src/features/reports/hooks/useGrossMargin.ts
//
// S57 P2.6 — Query hook for get_gross_margin_by_product_v1 RPC.
// Gross margin per product/category over a date window.
// Caveat: COGS uses the CURRENT WAC (products.cost_price), not a snapshot
// captured at sale time — surfaced in the page UI.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface GrossMarginProductRow {
  product_id:    string;
  name:          string;
  category_name: string | null;
  qty:           number;
  revenue:       number;
  cogs:          number;
  margin:        number;
  margin_pct:    number;
}

export interface GrossMarginCategoryRow {
  category_id?:   string | null;
  category_name: string | null;
  qty:           number;
  revenue:       number;
  cogs:          number;
  margin:        number;
  margin_pct:    number;
}

export interface GrossMarginSummary {
  revenue:    number;
  cogs:       number;
  margin:     number;
  margin_pct: number;
}

export interface GrossMarginData {
  period:      { start: string; end: string };
  summary:     GrossMarginSummary;
  by_product:  GrossMarginProductRow[];
  by_category: GrossMarginCategoryRow[];
}

export interface UseGrossMarginParams {
  start:       string;
  end:         string;
  categoryId?: string | null;
}

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function useGrossMargin(params: UseGrossMarginParams) {
  const { start, end, categoryId } = params;
  return useQuery<GrossMarginData, Error>({
    queryKey: ['gross-margin', start, end, categoryId ?? null],
    staleTime: 60_000,
    enabled: Boolean(start && end),
    queryFn: async () => {
      // `exactOptionalPropertyTypes`: omit the optional arg when no category.
      const args: { p_start_date: string; p_end_date: string; p_category_id?: string } = {
        p_start_date: start,
        p_end_date:   end,
      };
      if (categoryId) args.p_category_id = categoryId;
      const { data, error } = await supabase.rpc('get_gross_margin_by_product_v1', args);
      if (error) throw error as Error;
      const r = (data ?? {}) as Record<string, unknown>;
      const period  = (r.period  ?? {}) as Record<string, unknown>;
      const summary = (r.summary ?? {}) as Record<string, unknown>;
      const byProduct  = Array.isArray(r.by_product)  ? (r.by_product  as unknown[]) : [];
      const byCategory = Array.isArray(r.by_category) ? (r.by_category as unknown[]) : [];
      return {
        period: {
          start: String(period.start ?? start),
          end:   String(period.end   ?? end),
        },
        summary: {
          revenue:    toNum(summary.revenue),
          cogs:       toNum(summary.cogs),
          margin:     toNum(summary.margin),
          margin_pct: toNum(summary.margin_pct),
        },
        by_product: byProduct.map((p) => {
          const o = (p ?? {}) as Record<string, unknown>;
          return {
            product_id:    String(o.product_id ?? ''),
            name:          String(o.name ?? ''),
            category_name: o.category_name != null ? String(o.category_name) : null,
            qty:           toNum(o.qty),
            revenue:       toNum(o.revenue),
            cogs:          toNum(o.cogs),
            margin:        toNum(o.margin),
            margin_pct:    toNum(o.margin_pct),
          };
        }),
        by_category: byCategory.map((c) => {
          const o = (c ?? {}) as Record<string, unknown>;
          return {
            category_id:   o.category_id != null ? String(o.category_id) : null,
            category_name: o.category_name != null ? String(o.category_name) : null,
            qty:           toNum(o.qty),
            revenue:       toNum(o.revenue),
            cogs:          toNum(o.cogs),
            margin:        toNum(o.margin),
            margin_pct:    toNum(o.margin_pct),
          };
        }),
      } satisfies GrossMarginData;
    },
  });
}
