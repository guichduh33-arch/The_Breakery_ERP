// apps/backoffice/src/features/reports/hooks/useCashierVariance.ts
//
// Wraps `get_cashier_variance_v1(p_start_date, p_end_date)` — read-only cashier
// shift-variance report (fiche 12 D2.4). Returns a JSONB envelope.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface DowCell {
  dow:            number; // 0=Sunday … 6=Saturday
  sessions:       number;
  total_variance: number;
}

export interface CashierVarianceRow {
  cashier_id:     string;
  cashier_name:   string;
  sessions_count: number;
  cash: {
    total_variance: number;
    avg_variance:   number;
    total_short:    number;
    short_count:    number;
    over_count:     number;
    worst_variance: number;
  };
  qris: { counted_sessions: number; total_variance: number };
  card: { counted_sessions: number; total_variance: number };
  dow_cash: DowCell[];
}

export interface CashierVarianceReport {
  generated_at: string;
  start_date:   string;
  end_date:     string;
  timezone:     string;
  cashiers:     CashierVarianceRow[];
  totals: {
    sessions_count: number;
    cash: { total_variance: number; total_short: number; short_count: number; over_count: number };
    qris: { counted_sessions: number; total_variance: number };
    card: { counted_sessions: number; total_variance: number };
  };
}

export const CASHIER_VARIANCE_QK = ['reports', 'cashier-variance'] as const;

export function useCashierVariance(start: string, end: string) {
  return useQuery<CashierVarianceReport>({
    queryKey: [...CASHIER_VARIANCE_QK, start, end] as const,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_cashier_variance_v1', {
        p_start_date: start,
        p_end_date:   end,
      });
      if (error) {
        if (error.code === '42501') throw new Error('permission_denied');
        throw error;
      }
      return data as unknown as CashierVarianceReport;
    },
  });
}
