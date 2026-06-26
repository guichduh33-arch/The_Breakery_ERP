// apps/backoffice/src/features/reports/hooks/useProfitLoss.ts
//
// Wraps `get_profit_loss_v2(p_date_start, p_date_end, p_section_id?)`.
// S50 W1.2 — bumped v1 → v2 (permission gate: reports.financial.read).
// Returns the full JSONB envelope as a typed shape.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface PnlLine {
  account_id:    string;
  code:          string;
  name:          string;
  debit:         number;
  credit:        number;
  balance:       number;
  account_class: number;
}

export interface ProfitLoss {
  revenue: {
    sales:       number;
    discounts:   number;
    adjustments: number;
    total:       number;
  };
  cogs: {
    production: number;
    waste:      number;
    other:      number;
    total:      number;
  };
  gross_profit: number;
  opex: {
    salary:      number;
    rent:        number;
    utilities:   number;
    supplies:    number;
    marketing:   number;
    maintenance: number;
    other:       number;
    total:       number;
  };
  operating_profit: number;
  net_profit:       number;
  lines:            PnlLine[];
  period: {
    start:      string;
    end:        string;
    section_id: string | null;
  };
}

export const PROFIT_LOSS_QK = ['reports', 'profit-loss'] as const;

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function useProfitLoss(dateStart: string, dateEnd: string, sectionId?: string | null) {
  return useQuery<ProfitLoss>({
    queryKey: [...PROFIT_LOSS_QK, dateStart, dateEnd, sectionId ?? null] as const,
    staleTime: 60_000,
    queryFn: async () => {
      // `exactOptionalPropertyTypes` in this repo forbids `undefined` values
      // on optional-but-non-nullable properties, so omit the key when no
      // section filter is requested.
      const args: { p_date_start: string; p_date_end: string; p_section_id?: string } = {
        p_date_start: dateStart,
        p_date_end:   dateEnd,
      };
      if (sectionId) {
        args.p_section_id = sectionId;
      }
      const { data, error } = await supabase.rpc('get_profit_loss_v2', args);
      if (error) throw error;
      const r = (data ?? {}) as Record<string, unknown>;
      const rev  = (r.revenue ?? {}) as Record<string, unknown>;
      const cogs = (r.cogs    ?? {}) as Record<string, unknown>;
      const opex = (r.opex    ?? {}) as Record<string, unknown>;
      const period = (r.period ?? {}) as Record<string, unknown>;
      const linesRaw = Array.isArray(r.lines) ? (r.lines as unknown[]) : [];
      return {
        revenue: {
          sales:       toNum(rev.sales),
          discounts:   toNum(rev.discounts),
          adjustments: toNum(rev.adjustments),
          total:       toNum(rev.total),
        },
        cogs: {
          production: toNum(cogs.production),
          waste:      toNum(cogs.waste),
          other:      toNum(cogs.other),
          total:      toNum(cogs.total),
        },
        gross_profit: toNum(r.gross_profit),
        opex: {
          salary:      toNum(opex.salary),
          rent:        toNum(opex.rent),
          utilities:   toNum(opex.utilities),
          supplies:    toNum(opex.supplies),
          marketing:   toNum(opex.marketing),
          maintenance: toNum(opex.maintenance),
          other:       toNum(opex.other),
          total:       toNum(opex.total),
        },
        operating_profit: toNum(r.operating_profit),
        net_profit:       toNum(r.net_profit),
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
        period: {
          start:      String(period.start ?? dateStart),
          end:        String(period.end   ?? dateEnd),
          section_id: period.section_id != null ? String(period.section_id) : null,
        },
      };
    },
  });
}
