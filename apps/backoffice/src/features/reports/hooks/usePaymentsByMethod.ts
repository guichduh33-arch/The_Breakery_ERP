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

// Audit R-09 — la RPC pivote déjà un `by_day` par méthode, que ce hook jetait :
// la tuile du hub promet « Cash, Card, QRIS split + daily trend » alors que la
// tendance n'existait nulle part. Les clés viennent du pivot serveur.
export const PAYMENT_METHOD_KEYS = [
  'cash', 'qris', 'card', 'edc', 'transfer',
  'gopay', 'ovo', 'dana', 'store_credit', 'other',
] as const;

export type PaymentMethodKey = typeof PAYMENT_METHOD_KEYS[number];

export type PaymentByDayRow = Record<PaymentMethodKey, number> & {
  day:   string;
  total: number;
};

export interface PaymentsByMethodData {
  lines:     PaymentByMethodLine[];
  byDay:     PaymentByDayRow[];
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
      const rawDays = Array.isArray(raw.by_day) ? (raw.by_day as unknown[]) : [];
      return {
        lines:     Array.isArray(raw.by_method) ? (raw.by_method as PaymentByMethodLine[]) : [],
        byDay:     rawDays.map((d) => {
          const o = (d ?? {}) as Record<string, unknown>;
          const row = {
            day:   typeof o.day === 'string' ? o.day.slice(0, 10) : '',
            total: Number(o.total ?? 0),
          } as PaymentByDayRow;
          for (const k of PAYMENT_METHOD_KEYS) row[k] = Number(o[k] ?? 0);
          return row;
        }),
        total:     Number(summary.total_amount ?? 0),
        totalFees: Number(summary.total_fees_est ?? 0),
        totalNet:  Number(summary.total_net_est ?? 0),
        period:    (raw.period ?? { start: params.start, end: params.end }) as { start: string; end: string },
      } satisfies PaymentsByMethodData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
