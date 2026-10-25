// apps/backoffice/src/features/loyalty/hooks/useAdjustLoyaltyPoints.ts
//
// Ajustement via la famille adjust_loyalty_points, avec audit ADR-020 déc. 6.
// Le résultat doit confirmer acteur, clé et payload avant de solder la reprise.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { LOYALTY_CUSTOMERS_QUERY_KEY } from './useLoyaltyCustomersList.js';
import { loyaltyHistoryKey } from './useCustomerLoyaltyHistory.js';
import { FinancialAttemptError } from '@/lib/pendingFinancialAttempts.js';
import { finite, identifier, isRecord } from '@/lib/pendingFinancialAttemptSchema.js';
import { captureFinancialSession } from '@/lib/useFinancialAttempt.js';

export type AdjustErrorCode =
  | 'forbidden'
  | 'invalid_input'
  | 'insufficient_balance'
  | 'customer_deleted'
  | 'unknown';

export class AdjustError extends FinancialAttemptError {
  constructor(public code: AdjustErrorCode, message?: string, definitive = false) {
    super(message ?? code, definitive);
  }
}

export interface AdjustLoyaltyPointsArgs {
  customerId: string;
  delta:      number;
  reason:     string;
  idempotencyKey: string;
  sessionGuard?: () => boolean;
}

export interface AdjustLoyaltyPointsResult {
  txn_id:       string;
  new_balance:  number;
  new_lifetime: number;
  customer_id: string;
  delta: number;
  reason: string;
  actor_id: string;
  idempotency_key: string;
  idempotent_replay: boolean;
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
  return useMutation({
    retry: false,
    meta: { errorHandled: true },
    onMutate: () => captureFinancialSession(),
    mutationFn: async (args: AdjustLoyaltyPointsArgs): Promise<AdjustLoyaltyPointsResult> => {
      const session = captureFinancialSession();
      const assertSession = () => {
        if (!session.current() || args.sessionGuard?.() === false) {
          throw new AdjustError('unknown', 'Your session changed. Reopen this form.');
        }
      };
      assertSession();
      const { data, error } = await supabase.rpc('adjust_loyalty_points_v3', {
        p_customer_id: args.customerId, p_delta: args.delta, p_reason: args.reason,
        p_idempotency_key: args.idempotencyKey,
      });
      assertSession();
      if (error) throw new AdjustError(classify(error.message), error.message,
        adjustmentDefinitiveFailure(error.code, error.message));
      if (!validAdjustmentResult(data, args, session.profileId)) {
        throw new AdjustError('unknown', 'The adjustment response could not confirm this attempt. Its result is unconfirmed.');
      }
      return data;
    },
    onSuccess: async (_data, args, session) => {
      if (!session?.current() || args.sessionGuard?.() === false) return;
      const customerId = args.customerId;
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['customer-detail', customerId] }),
        qc.invalidateQueries({ queryKey: ['customers'] }),
        qc.invalidateQueries({ queryKey: LOYALTY_CUSTOMERS_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: loyaltyHistoryKey(customerId) }),
      ]);
    },
  });
}

export function adjustmentDefinitiveFailure(code: string, message: string): boolean {
  return (code === 'P0001' && /^(forbidden|invalid_input|insufficient_balance|customer_deleted)$/.test(message))
    || (code === '23514' && message === 'idempotency_key_required');
}

export function validAdjustmentResult(data: unknown, args: AdjustLoyaltyPointsArgs, profileId: string | undefined): data is AdjustLoyaltyPointsResult {
  return isRecord(data) && identifier(data.txn_id) && data.customer_id === args.customerId
    && Boolean(profileId) && data.actor_id === profileId && data.idempotency_key === args.idempotencyKey
    && data.delta === args.delta && data.reason === args.reason.trim()
    && finite(data.new_balance) && Number.isInteger(data.new_balance) && data.new_balance >= 0
    && finite(data.new_lifetime) && Number.isInteger(data.new_lifetime) && data.new_lifetime >= 0
    && typeof data.idempotent_replay === 'boolean';
}
