// apps/backoffice/src/features/reports/hooks/usePb1Report.ts
// S30 Wave 4.1 — Query hook for get_pb1_report RPC (month/year selector).
// Lot A1 (campagne Reports 2026-08-15) — le cast aveugle `data as Pb1ReportData`
// laissait passer n'importe quelle forme ; parse défensif champ par champ.
// Lot D1 : _v1 → _v2 (gate reports.financial.read ajouté sur calculate_pb1_payable,
// cascade forcée sur get_pb1_report — seul appelant).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { asArray, asRecord, toNum, toStr } from '../utils/parse.js';

export interface Pb1ByDay {
  day:            string;
  taxable_base:   number;
  pb1_collected:  number;
}

export interface Pb1ReportData {
  period: {
    month: number;
    year:  number;
    start: string;
    end:   string;
  };
  pb1_rate:              number;
  taxable_base:          number;
  pb1_collected:         number;
  pb1_payable:           number;
  by_day:                Pb1ByDay[];
  balance_account_code:  string;
  balance_at_period_end: number;
}

export interface UsePb1ReportParams {
  month: number; // 1–12
  year:  number;
}

export function usePb1Report(params: UsePb1ReportParams) {
  return useQuery<Pb1ReportData, Error>({
    queryKey: ['reports', 'pb1', params.month, params.year],
    queryFn:  async () => {
      const { data, error } = await supabase.rpc('get_pb1_report_v2', {
        p_period_month: params.month,
        p_period_year:  params.year,
      });
      if (error) throw error as Error;
      const raw    = asRecord(data);
      const period = asRecord(raw.period);
      return {
        period: {
          month: toNum(period.month) || params.month,
          year:  toNum(period.year)  || params.year,
          start: toStr(period.start),
          end:   toStr(period.end),
        },
        pb1_rate:      toNum(raw.pb1_rate),
        taxable_base:  toNum(raw.taxable_base),
        pb1_collected: toNum(raw.pb1_collected),
        pb1_payable:   toNum(raw.pb1_payable),
        by_day: asArray(raw.by_day).map((d): Pb1ByDay => {
          const o = asRecord(d);
          return {
            day:           toStr(o.day),
            taxable_base:  toNum(o.taxable_base),
            pb1_collected: toNum(o.pb1_collected),
          };
        }),
        balance_account_code:  toStr(raw.balance_account_code),
        balance_at_period_end: toNum(raw.balance_at_period_end),
      } satisfies Pb1ReportData;
    },
    enabled: Boolean(params.month && params.year),
  });
}
