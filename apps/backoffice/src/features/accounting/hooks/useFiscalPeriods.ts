// apps/backoffice/src/features/accounting/hooks/useFiscalPeriods.ts
// Session 26b / Wave 5 — SELECT fiscal_periods ORDER BY period_start DESC.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface FiscalPeriodRow {
  id:           string;
  period_start: string;
  period_end:   string;
  status:       'open' | 'closed' | 'locked' | string;
  closed_at:    string | null;
  locked_at:    string | null;
}

export const FISCAL_PERIODS_KEY = ['accounting', 'fiscal-periods'] as const;

export function useFiscalPeriods() {
  return useQuery<FiscalPeriodRow[]>({
    queryKey: FISCAL_PERIODS_KEY,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fiscal_periods')
        .select('id, period_start, period_end, status, closed_at, locked_at')
        .order('period_start', { ascending: false })
        .limit(48);
      if (error) throw error;
      return (data ?? []) as FiscalPeriodRow[];
    },
  });
}
