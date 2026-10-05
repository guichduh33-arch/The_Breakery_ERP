// apps/pos/src/features/shift/hooks/useCashMovement.ts
// Session 26 / Wave 1.F — bumped to record_cash_movement_v2.
// Adds optional `reason_code` to trigger JE emission (apport_owner / bank_transfer).
// `replenishment` and `misc` (or null) keep the legacy behavior (no JE).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type CashMovementReasonCode =
  | 'apport_owner'
  | 'bank_transfer'
  | 'replenishment'
  | 'misc';

export interface CashMovementInput {
  session_id:       string;
  direction:        'in' | 'out';
  amount:           number;
  reason:           string;
  reason_code?:     CashMovementReasonCode;
  idempotency_key?: string;
}

export interface CashMovementResult {
  movement_id:       string;
  session_id:        string;
  cash_in_total:     number;
  cash_out_total:    number;
  je_id:             string | null;
  idempotent_replay: boolean;
}

export function useCashMovement() {
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (input: CashMovementInput): Promise<CashMovementResult> => {
      const args: {
        p_session_id:       string;
        p_direction:        string;
        p_amount:           number;
        p_reason:           string;
        p_idempotency_key?: string;
        p_reason_code?:     CashMovementReasonCode;
      } = {
        p_session_id: input.session_id,
        p_direction:  input.direction,
        p_amount:     input.amount,
        p_reason:     input.reason,
      };
      if (input.idempotency_key !== undefined) args.p_idempotency_key = input.idempotency_key;
      if (input.reason_code !== undefined)     args.p_reason_code     = input.reason_code;
      const { data, error } = await supabase.rpc('record_cash_movement_v2', args);
      if (error) throw Object.assign(new Error(error.message), { details: error });
      const result = data as unknown as CashMovementResult | null;
      if (typeof result?.movement_id !== 'string' || !result.movement_id || result.session_id !== input.session_id
        || !Number.isFinite(result.cash_in_total) || !Number.isFinite(result.cash_out_total)) {
        throw new Error('Cash movement confirmation unavailable — retry the saved movement');
      }
      return result;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pos_sessions'] });
      void qc.invalidateQueries({ queryKey: ['cash_movements'] });
    },
  });
}
