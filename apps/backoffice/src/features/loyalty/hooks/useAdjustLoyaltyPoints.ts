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
import { mintLoyaltyPointsAuthorization } from './useMintLoyaltyPointsAuthorization.js';

export type AdjustErrorCode =
  | 'forbidden'
  | 'invalid_input'
  | 'insufficient_balance'
  | 'customer_deleted'
  | 'pin_required'       // delta > 0 sans PIN manager fourni
  | 'wrong_pin'          // EF 400/401 — PIN invalide
  | 'pin_forbidden'      // EF 403 / RPC P0003 — manager sans loyalty.adjust, nonce brûlé/expiré
  | 'rate_limited'       // EF 429
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
  /** PIN manager, requis si delta > 0 (jamais persisté : ne pas le mettre dans le payload de reprise). */
  managerPin?: string;
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

function classifyMint(status: number): AdjustErrorCode {
  if (status === 429) return 'rate_limited';
  if (status === 403) return 'pin_forbidden';
  return 'wrong_pin';
}

function classify(message: string, code?: string): AdjustErrorCode {
  if (code === 'P0003')                         return 'pin_forbidden';
  if (message.includes('forbidden'))          return 'forbidden';
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
      // Décision 2026-11-21 : ajouter des points exige un PIN manager (nonce minté
      // avant l'appel, un échec RPC le brûle — la tentative suivante re-minte).
      // Un débit n'en a pas besoin. Un échec ici n'a aucun effet : définitif.
      let authorizationId: string | undefined;
      if (args.delta > 0) {
        if (!args.managerPin) throw new AdjustError('pin_required', 'Manager PIN required to add points', true);
        try {
          authorizationId = await mintLoyaltyPointsAuthorization(args.managerPin);
        } catch (err) {
          const status = (err as { status?: number }).status ?? 0;
          throw new AdjustError(classifyMint(status), (err as Error).message, true);
        }
        assertSession();
      }
      const { data, error } = await supabase.rpc('adjust_loyalty_points_v4', {
        p_customer_id: args.customerId, p_delta: args.delta, p_reason: args.reason,
        p_idempotency_key: args.idempotencyKey,
        ...(authorizationId ? { p_authorization_id: authorizationId } : {}),
      });
      assertSession();
      if (error) throw new AdjustError(classify(error.message, error.code), error.message,
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
    || code === 'P0003' // nonce PIN refusé : rien n'a été écrit, la transaction est annulée
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
