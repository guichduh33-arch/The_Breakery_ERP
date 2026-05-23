// apps/backoffice/src/features/accounting/hooks/usePb1Payable.ts
// Session 26c / Wave 1 — Wraps calculate_pb1_payable_v1 RPC.
// NON-PKP (ADR-003) : pb1_payable = pb1_output (pas de VAT input deduction).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface Pb1PayablePayload {
  period_start: string;
  period_end:   string;
  pb1_output:   number;
  pb1_payable:  number;
  tax_rate:     number;
  tax_regime:   string;
  note:         string;
}

export const PB1_PAYABLE_KEY = ['accounting', 'pb1-payable'] as const;

export function usePb1Payable(startDate: string, endDate: string) {
  return useQuery<Pb1PayablePayload>({
    queryKey: [...PB1_PAYABLE_KEY, startDate, endDate],
    enabled: startDate !== '' && endDate !== '',
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('calculate_pb1_payable_v1', {
        p_period_start: startDate,
        p_period_end:   endDate,
      });
      if (error !== null) throw new Error(error.message);
      return data as unknown as Pb1PayablePayload;
    },
  });
}
