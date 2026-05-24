// apps/backoffice/src/features/reports/hooks/usePb1Report.ts
// S30 Wave 4.1 — Query hook for get_pb1_report_v1 RPC (month/year selector).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

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
      const { data, error } = await supabase.rpc('get_pb1_report_v1', {
        p_month: params.month,
        p_year:  params.year,
      });
      if (error) throw error;
      return data as Pb1ReportData;
    },
    enabled: Boolean(params.month && params.year),
  });
}
