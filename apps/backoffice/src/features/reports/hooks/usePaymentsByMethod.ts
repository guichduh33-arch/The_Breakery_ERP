// apps/backoffice/src/features/reports/hooks/usePaymentsByMethod.ts
// S30 Wave 4.1 — Query hook for get_payments_by_method RPC (repointed v1 → v2, S57).
// Lot C (ADR-006 déc. 9) — repointed v2 → v3 : chaque ligne porte
// fee_pct/fee_est/net_est (frais informatifs, business_config.payment_method_fees)
// et le summary expose total_fees_est/total_net_est.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface PaymentByMethodLine {
  method:     string;
  amount:     number;
  count:      number;
  share_pct:  number;
  fee_pct:    number;
  fee_est:    number;
  net_est:    number;
}

export interface PaymentsByMethodData {
  lines:     PaymentByMethodLine[];
  total:     number;
  totalFees: number;
  totalNet:  number;
  period:    { start: string; end: string };
}

export interface UsePaymentsByMethodParams {
  start: string;
  end:   string;
}

export function usePaymentsByMethod(params: UsePaymentsByMethodParams) {
  return useQuery<PaymentsByMethodData, Error>({
    queryKey: ['reports', 'payments_by_method', params.start, params.end],
    queryFn:  async () => {
      const { data, error } = await supabase.rpc('get_payments_by_method_v3', {
        p_date_start: params.start,
        p_date_end:   params.end,
      });
      if (error) throw error as Error;
      // RPC returns { period, summary:{ total_amount, … }, by_method:[…], by_day:[…] }.
      // Map to this hook's stable { lines, total, … period } contract.
      const raw     = (data ?? {}) as Record<string, unknown>;
      const summary = (raw.summary ?? {}) as Record<string, unknown>;
      return {
        lines:     Array.isArray(raw.by_method) ? (raw.by_method as PaymentByMethodLine[]) : [],
        total:     Number(summary.total_amount ?? 0),
        totalFees: Number(summary.total_fees_est ?? 0),
        totalNet:  Number(summary.total_net_est ?? 0),
        period:    (raw.period ?? { start: params.start, end: params.end }) as { start: string; end: string },
      } satisfies PaymentsByMethodData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
