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
        p_start: params.start,
        p_end:   params.end,
      });
      if (error) throw error as Error;
      return data as PaymentsByMethodData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
