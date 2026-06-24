// apps/backoffice/src/features/reports/hooks/useExpensesByCategory.ts
//
// Wraps get_expenses_by_category_v1 — operating-expense ledger ventilated by
// expense category + by day. NULL status = committed spend (excl. draft/
// rejected). Gate reports.financial.read.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { CostByDayPoint } from './usePurchaseCogsBreakdown.js';

export type { CostByDayPoint };

export interface ExpenseCategoryRow {
  category_id: string;
  code:        string;
  name:        string;
  total:       number;
  count:       number;
  share_pct:   number;
}

export interface ExpensesByCategory {
  period:      { start: string; end: string };
  summary:     { total: number; count: number; avg: number };
  by_category: ExpenseCategoryRow[];
  by_day:      CostByDayPoint[];
}

export interface UseExpensesByCategoryParams {
  start:       string;
  end:         string;
  categoryId?: string | null;
  status?:     string | null;
}

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toStr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

export function useExpensesByCategory(params: UseExpensesByCategoryParams) {
  return useQuery<ExpensesByCategory, Error>({
    queryKey: [
      'reports', 'expenses-by-category',
      params.start, params.end, params.categoryId ?? null, params.status ?? null,
    ],
    staleTime: 60_000,
    enabled: Boolean(params.start && params.end),
    queryFn: async () => {
      const args: {
        p_date_start: string; p_date_end: string;
        p_category_id?: string; p_status?: string;
      } = { p_date_start: params.start, p_date_end: params.end };
      if (params.categoryId) args.p_category_id = params.categoryId;
      if (params.status)     args.p_status     = params.status;

      const { data, error } = await supabase.rpc('get_expenses_by_category_v1', args);
      if (error) throw error as Error;

      const r = (data ?? {}) as Record<string, unknown>;
      const period  = (r.period  ?? {}) as Record<string, unknown>;
      const summary = (r.summary ?? {}) as Record<string, unknown>;
      const cats    = Array.isArray(r.by_category) ? (r.by_category as unknown[]) : [];
      const days    = Array.isArray(r.by_day)      ? (r.by_day as unknown[])      : [];

      return {
        period: {
          start: toStr(period.start, params.start),
          end:   toStr(period.end,   params.end),
        },
        summary: {
          total: toNum(summary.total),
          count: toNum(summary.count),
          avg:   toNum(summary.avg),
        },
        by_category: cats.map((c) => {
          const o = (c ?? {}) as Record<string, unknown>;
          return {
            category_id: toStr(o.category_id, ''),
            code:        toStr(o.code, ''),
            name:        toStr(o.name, ''),
            total:       toNum(o.total),
            count:       toNum(o.count),
            share_pct:   toNum(o.share_pct),
          };
        }),
        by_day: days.map((d) => {
          const o = (d ?? {}) as Record<string, unknown>;
          return { date: toStr(o.date, ''), total: toNum(o.total) };
        }),
      } satisfies ExpensesByCategory;
    },
  });
}
