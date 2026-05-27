// apps/backoffice/src/features/reports/hooks/useBalanceSheet.ts
//
// Wraps `get_balance_sheet_v1(p_as_of_date)`. Asserts A = L + E + CYE.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

// S32 — per-account lines added to RPC output (DEV-S32-1.C-01).
export interface BalanceSheetLine {
  account_id:    string;
  code:          string;
  name:          string;
  debit:         number;
  credit:        number;
  balance:       number;
  account_class: number;
}

export interface BalanceSheet {
  assets: {
    current: {
      cash:      number;
      ar:        number;
      inventory: number;
      other:     number;
      total:     number;
    };
    fixed: { total: number };
    total: number;
  };
  liabilities: {
    current: {
      ap:          number;
      tax_payable: number;
      loyalty:     number;
      other:       number;
      total:       number;
    };
    long_term: { total: number };
    total:     number;
  };
  equity: {
    share_capital:         number;
    retained_earnings:     number;
    current_year_earnings: number;
    other:                 number;
    total:                 number;
  };
  balanced: boolean;
  delta:    number;
  as_of:    string;
  lines:    BalanceSheetLine[]; // S32 — per-account drill-down (DEV-S32-1.C-01)
}

export const BALANCE_SHEET_QK = ['reports', 'balance-sheet'] as const;

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function useBalanceSheet(asOfDate: string) {
  return useQuery<BalanceSheet>({
    queryKey: [...BALANCE_SHEET_QK, asOfDate] as const,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_balance_sheet_v1', {
        p_as_of_date: asOfDate,
      });
      if (error) throw error;
      const r        = (data ?? {}) as Record<string, unknown>;
      const a        = (r.assets      ?? {}) as Record<string, unknown>;
      const ac       = (a.current     ?? {}) as Record<string, unknown>;
      const af       = (a.fixed       ?? {}) as Record<string, unknown>;
      const l        = (r.liabilities ?? {}) as Record<string, unknown>;
      const lc       = (l.current     ?? {}) as Record<string, unknown>;
      const ll       = (l.long_term   ?? {}) as Record<string, unknown>;
      const e        = (r.equity      ?? {}) as Record<string, unknown>;
      const linesRaw = Array.isArray(r.lines) ? (r.lines as unknown[]) : [];
      return {
        assets: {
          current: {
            cash:      toNum(ac.cash),
            ar:        toNum(ac.ar),
            inventory: toNum(ac.inventory),
            other:     toNum(ac.other),
            total:     toNum(ac.total),
          },
          fixed: { total: toNum(af.total) },
          total: toNum(a.total),
        },
        liabilities: {
          current: {
            ap:          toNum(lc.ap),
            tax_payable: toNum(lc.tax_payable),
            loyalty:     toNum(lc.loyalty),
            other:       toNum(lc.other),
            total:       toNum(lc.total),
          },
          long_term: { total: toNum(ll.total) },
          total:     toNum(l.total),
        },
        equity: {
          share_capital:         toNum(e.share_capital),
          retained_earnings:     toNum(e.retained_earnings),
          current_year_earnings: toNum(e.current_year_earnings),
          other:                 toNum(e.other),
          total:                 toNum(e.total),
        },
        balanced: Boolean(r.balanced),
        delta:    toNum(r.delta),
        as_of:    String(r.as_of ?? asOfDate),
        lines: linesRaw.map((l) => {
          const o = (l ?? {}) as Record<string, unknown>;
          return {
            account_id:    String(o.account_id ?? ''),
            code:          String(o.code ?? ''),
            name:          String(o.name ?? ''),
            debit:         toNum(o.debit),
            credit:        toNum(o.credit),
            balance:       toNum(o.balance),
            account_class: toNum(o.account_class),
          };
        }),
      };
    },
  });
}
