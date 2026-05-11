// apps/backoffice/src/features/loyalty/hooks/useAdjustLoyaltyPoints.ts
//
// Calls adjust_loyalty_points RPC (session 12). Surfaces RPC errors as a
// typed enum so the modal can map them to inline form errors.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { LOYALTY_CUSTOMERS_QUERY_KEY } from './useLoyaltyCustomersList.js';
import { loyaltyHistoryKey } from './useCustomerLoyaltyHistory.js';

export type AdjustErrorCode =
  | 'forbidden'
  | 'invalid_input'
  | 'insufficient_balance'
  | 'customer_deleted'
  | 'unknown';

export class AdjustError extends Error {
  constructor(public code: AdjustErrorCode, message?: string) {
    super(message ?? code);
  }
}

export interface AdjustLoyaltyPointsArgs {
  customerId: string;
  delta:      number;
  reason:     string;
}

export interface AdjustLoyaltyPointsResult {
  txn_id:       string;
  new_balance:  number;
  new_lifetime: number;
}

function classify(message: string): AdjustErrorCode {
  if (message.includes('forbidden'))            return 'forbidden';
  if (message.includes('invalid_input'))        return 'invalid_input';
  if (message.includes('insufficient_balance')) return 'insufficient_balance';
  if (message.includes('customer_deleted'))     return 'customer_deleted';
  return 'unknown';
}

export function useAdjustLoyaltyPoints() {
  const qc = useQueryClient();
  return useMutation<AdjustLoyaltyPointsResult, AdjustError, AdjustLoyaltyPointsArgs>({
    mutationFn: async ({ customerId, delta, reason }) => {
      const { data, error } = await supabase.rpc('adjust_loyalty_points', {
        p_customer_id: customerId, p_delta: delta, p_reason: reason,
      });
      if (error) throw new AdjustError(classify(error.message), error.message);
      const row = (data as AdjustLoyaltyPointsResult[] | null)?.[0];
      if (!row) throw new AdjustError('unknown', 'Empty response');
      return row;
    },
    onSuccess: async (_data, { customerId }) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: LOYALTY_CUSTOMERS_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: loyaltyHistoryKey(customerId) }),
      ]);
    },
  });
}
