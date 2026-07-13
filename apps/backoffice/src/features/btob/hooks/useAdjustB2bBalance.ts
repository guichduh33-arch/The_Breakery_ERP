// apps/backoffice/src/features/btob/hooks/useAdjustB2bBalance.ts
//
// S76 — câblage inventaire ⚫ #13 : adjust_b2b_balance_v2 (JE + PIN manager).
// Idempotence flavor 2 (S25) : UUID stable par intention via useRef, rotation
// après succès. PIN en arg RPC = pattern pré-existant S37 (cf. useSignZReport).

import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { B2B_DRIFT_QK } from './useB2bBalanceDrift.js';

export interface AdjustB2bBalanceResult {
  customer_id:       string;
  balance_before:    number;
  balance_after:     number;
  delta:             number;
  je_id:             string | null;
  audit_log_id:      string;
  idempotent_replay: boolean;
}

export interface AdjustB2bBalanceInput {
  delta:      number;
  reason:     string;
  managerPin: string;
}

export function useAdjustB2bBalance(customerId: string) {
  const qc = useQueryClient();
  const keyRef = useRef<string>(crypto.randomUUID());

  return useMutation<AdjustB2bBalanceResult, Error, AdjustB2bBalanceInput>({
    mutationFn: async ({ delta, reason, managerPin }) => {
      const { data, error } = await supabase.rpc('adjust_b2b_balance_v2', {
        p_customer_id:     customerId,
        p_delta:           delta,
        p_reason:          reason,
        p_manager_pin:     managerPin,
        p_idempotency_key: keyRef.current,
      });
      if (error) throw error;
      return data as unknown as AdjustB2bBalanceResult;
    },
    onSuccess: () => {
      keyRef.current = crypto.randomUUID(); // prochaine intention = nouvelle clé
      void qc.invalidateQueries({ queryKey: ['customer-detail', customerId] });
      void qc.invalidateQueries({ queryKey: B2B_DRIFT_QK });
    },
  });
}
