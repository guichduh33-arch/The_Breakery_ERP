// apps/backoffice/src/features/accounting/hooks/useTrialBalance.ts
// Session 26b / Wave 4 — Wraps get_trial_balance RPC.
// S50 W1.2 — bumped v1 → v2 (permission gate: accounting.tb.read).
// S50 V2a-i T3 — bumped v2 → v3 : `balance` des comptes permanents (classe 1/2/3) reflète
//   désormais le solde cumulatif as-of (ouverture + période), pas seulement les mouvements de
//   période ; nouveau champ `opening_balance` par ligne. `total_debit`/`total_credit`/`balanced`
//   restent les mouvements de période (badge « Balanced » inchangé).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface TrialBalanceLine {
  account_id:      string;
  code:            string;
  name:            string;
  account_class:   number;
  balance_type:    string;
  total_debit:     number;
  total_credit:    number;
  balance:         number;
  /** S50 V2a-i T3 — solde signé cumulé strictement avant la date de début (comptes permanents). */
  opening_balance: number;
}

export interface TrialBalancePayload {
  period:       { start: string; end: string };
  lines:        TrialBalanceLine[];
  total_debit:  number;
  total_credit: number;
  balanced:     boolean;
  delta:        number;
}

export const TRIAL_BALANCE_KEY = ['accounting', 'trial-balance'] as const;

export function useTrialBalance(startDate: string, endDate: string) {
  return useQuery<TrialBalancePayload>({
    queryKey: [...TRIAL_BALANCE_KEY, startDate, endDate],
    enabled: startDate !== '' && endDate !== '',
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_trial_balance_v3', {
        p_date_start: startDate,
        p_date_end:   endDate,
      });
      if (error !== null) throw new Error(error.message);
      return data as unknown as TrialBalancePayload;
    },
  });
}
