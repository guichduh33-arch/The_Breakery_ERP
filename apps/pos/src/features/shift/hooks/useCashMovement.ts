// apps/pos/src/features/shift/hooks/useCashMovement.ts
// Session 13 / Phase 3.C — React Query mutation wrapper around
// record_cash_movement_v1 (mid-shift in/out).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface CashMovementInput {
  session_id:       string;
  direction:        'in' | 'out';
  amount:           number;
  reason:           string;
  idempotency_key?: string;
}

export interface CashMovementResult {
  movement_id:       string;
  session_id:        string;
  cash_in_total:     number;
  cash_out_total:    number;
  idempotent_replay: boolean;
}

export function useCashMovement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CashMovementInput): Promise<CashMovementResult> => {
      const args: {
        p_session_id:       string;
        p_direction:        string;
        p_amount:           number;
        p_reason:           string;
        p_idempotency_key?: string;
      } = {
        p_session_id: input.session_id,
        p_direction:  input.direction,
        p_amount:     input.amount,
        p_reason:     input.reason,
      };
      if (input.idempotency_key !== undefined) args.p_idempotency_key = input.idempotency_key;
      const { data, error } = await supabase.rpc('record_cash_movement_v1', args);
      if (error) throw new Error(error.message);
      return data as unknown as CashMovementResult;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pos_sessions'] });
      void qc.invalidateQueries({ queryKey: ['cash_movements'] });
    },
  });
}
