// apps/backoffice/src/features/accounting/hooks/useReopenFiscalPeriod.ts
// S1-03 — rouvre une période `closed` (famille `reopen_fiscal_period`).
// Réservé au propriétaire, sous PIN ; `locked` reste irréversible côté serveur.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { FISCAL_PERIODS_KEY } from './useFiscalPeriods.js';

export interface ReopenFiscalPeriodArgs {
  periodId:   string;
  managerPin: string;
  reason?:    string | undefined;
}

export function useReopenFiscalPeriod() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, ReopenFiscalPeriodArgs>({
    mutationFn: async ({ periodId, managerPin, reason }) => {
      const trimmed = reason?.trim() ?? '';
      const { data, error } = await supabase.rpc('reopen_fiscal_period_v1', {
        p_period_id:   periodId,
        p_manager_pin: managerPin,
        ...(trimmed === '' ? {} : { p_reason: trimmed }),
      });
      // Un refus retourné permet au serveur de commiter le compteur PIN.
      if (data && typeof data === 'object' && !Array.isArray(data) && data.ok === false) {
        throw new Error(typeof data.error === 'string' ? data.error : 'invalid_pin');
      }
      if (error !== null) throw new Error(error.message);
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: FISCAL_PERIODS_KEY });
    },
  });
}
