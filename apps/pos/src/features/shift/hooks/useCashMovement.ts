// Chaque mouvement de tiroir possède une contrepartie comptable explicite.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

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
  counterparty_account_code?: string;
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
        p_counterparty_account_code?: string;
      } = {
        p_session_id: input.session_id,
        p_direction:  input.direction,
        p_amount:     input.amount,
        p_reason:     input.reason,
      };
      if (input.idempotency_key !== undefined) args.p_idempotency_key = input.idempotency_key;
      if (input.reason_code !== undefined)     args.p_reason_code     = input.reason_code;
      if (input.counterparty_account_code !== undefined) args.p_counterparty_account_code = input.counterparty_account_code;
      const { data, error } = await supabase.rpc('record_cash_movement_v4', args);
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

export function useCashMovementCounterparties(enabled: boolean) {
  const userId = useAuthStore((s) => s.user?.id);
  return useQuery({
    queryKey: ['cash-movement-counterparties', userId], enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_cash_movement_counterparties_v2');
      if (error) throw new Error(error.message);
      if (!Array.isArray(data) || data.some((a) => typeof a.code !== 'string'
        || typeof a.name !== 'string' || typeof a.is_cash !== 'boolean')) {
        throw new Error('Accounting accounts unavailable');
      }
      return data;
    },
  });
}
