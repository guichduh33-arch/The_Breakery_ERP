// apps/backoffice/src/features/reports/hooks/useCashFlow.ts
//
// Wraps `get_cash_flow_v3(p_date_start, p_date_end)`. Methode indirecte par
// CONTREPARTIE : operating + investing + financing = cash_end - cash_start par
// identite de la partie double, et non plus `net_change := operating_total`.
//
// v2 n'additionnait que trois familles de comptes (AR, stocks, fournisseurs) :
// la PB1 collectee, encaissee en tresorerie mais creditee en dette (2110),
// n'apparaissait nulle part. Sur juillet 2026 l'ecran annoncait -515 546 quand
// la tresorerie montait de +628 554 — le signe lui-meme etait faux. La ligne
// `non_cash_adjustments`, qui valait 0 en dur, porte desormais ce montant.
//
// Audit Reports 2026-08-01 lot C / D1 — la v1 etait SECURITY INVOKER sans gate
// et `journal_entry_lines` a pour policy is_authenticated(), donc un caissier
// pouvait lire la tresorerie complete. v2 puis v3 sont SECURITY DEFINER et
// gatees sur reports.financial.read.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface CashFlow {
  operating: {
    net_profit:           number;
    delta_ar:             number;
    delta_ap:             number;
    delta_inventory:      number;
    non_cash_adjustments: number;
    total:                number;
  };
  investing:          { total: number };
  financing:          { total: number };
  net_change_in_cash: number;
  cash_start:         number;
  cash_end:           number;
  period: {
    start: string;
    end:   string;
  };
}

export const CASH_FLOW_QK = ['reports', 'cash-flow'] as const;

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** `String(x)` sur un Json peut rendre « [object Object] » : on borne au string. */
function toStr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

export function useCashFlow(dateStart: string, dateEnd: string) {
  return useQuery<CashFlow>({
    queryKey: [...CASH_FLOW_QK, dateStart, dateEnd] as const,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_cash_flow_v3', {
        p_date_start: dateStart,
        p_date_end:   dateEnd,
      });
      if (error) throw error;
      const r  = (data ?? {}) as Record<string, unknown>;
      const op = (r.operating ?? {}) as Record<string, unknown>;
      const iv = (r.investing ?? {}) as Record<string, unknown>;
      const fn = (r.financing ?? {}) as Record<string, unknown>;
      const period = (r.period ?? {}) as Record<string, unknown>;
      return {
        operating: {
          net_profit:           toNum(op.net_profit),
          delta_ar:             toNum(op.delta_ar),
          delta_ap:             toNum(op.delta_ap),
          delta_inventory:      toNum(op.delta_inventory),
          non_cash_adjustments: toNum(op.non_cash_adjustments),
          total:                toNum(op.total),
        },
        investing:          { total: toNum(iv.total) },
        financing:          { total: toNum(fn.total) },
        net_change_in_cash: toNum(r.net_change_in_cash),
        cash_start:         toNum(r.cash_start),
        cash_end:           toNum(r.cash_end),
        period: {
          start: toStr(period.start, dateStart),
          end:   toStr(period.end,   dateEnd),
        },
      };
    },
  });
}
