// apps/backoffice/src/features/reports/hooks/usePaymentsByMethod.ts
// S30 Wave 4.1 — Query hook for get_payments_by_method_v1 RPC.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface PaymentByMethodLine {
  method:     string;
  amount:     number;
  count:      number;
  share_pct:  number;
}

export interface PaymentsByMethodData {
  lines:  PaymentByMethodLine[];
  total:  number;
  period: { start: string; end: string };
}

export interface UsePaymentsByMethodParams {
  start: string;
  end:   string;
}

export function usePaymentsByMethod(params: UsePaymentsByMethodParams) {
  return useQuery<PaymentsByMethodData, Error>({
    queryKey: ['reports', 'payments_by_method', params.start, params.end],
    queryFn:  async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('get_payments_by_method_v1', {
        p_date_start: params.start,
        p_date_end:   params.end,
      });
      if (error) throw error as Error;
      // RPC returns { period, summary:{ total_amount, … }, by_method:[…], by_day:[…] }.
      // Map to this hook's stable { lines, total, period } contract.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (data ?? {}) as any;
      return {
        lines:  (raw.by_method ?? []) as PaymentByMethodLine[],
        total:  Number(raw.summary?.total_amount ?? 0),
        period: raw.period ?? { start: params.start, end: params.end },
      } satisfies PaymentsByMethodData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
