// apps/backoffice/src/features/accounting/hooks/useCloseFiscalPeriod.ts
// Session 26b / Wave 5 — Wraps close_fiscal_period_v1 RPC.
// p_lock=true → status 'locked' (no more backdating) ; p_lock=false → 'closed'.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { FISCAL_PERIODS_KEY } from './useFiscalPeriods.js';

export interface CloseFiscalPeriodArgs {
  periodId:   string;
  managerPin: string;
  lock:       boolean;
}

export function useCloseFiscalPeriod() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, CloseFiscalPeriodArgs>({
    mutationFn: async ({ periodId, managerPin, lock }) => {
      const { data, error } = await supabase.rpc('close_fiscal_period_v2', {
        p_period_id:   periodId,
        p_manager_pin: managerPin,
        p_lock:        lock,
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
