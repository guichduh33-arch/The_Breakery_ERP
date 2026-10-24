// apps/backoffice/src/features/customers/hooks/useConvertLoyaltyToStoreCredit.ts
// ADR-013 Lot 4 (D6) — conversion points fidélité → avoir (BO seulement,
// permission customers.store_credit.convert vérifiée in-RPC). Taux serveur :
// 1 pt = Rp 10, points par multiples de 100. Idempotence via p_idempotency_key.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { loyaltyHistoryKey } from '@/features/loyalty/hooks/useCustomerLoyaltyHistory.js';
import { storeCreditHistoryKey } from './useStoreCreditHistory.js';
import { FinancialAttemptError } from '@/lib/pendingFinancialAttempts.js';
import { finite, identifier, isRecord } from '@/lib/pendingFinancialAttemptSchema.js';
import { captureFinancialSession } from '@/lib/useFinancialAttempt.js';
import { LOYALTY_CUSTOMERS_QUERY_KEY } from '@/features/loyalty/hooks/useLoyaltyCustomersList.js';

export type ConvertErrorCode =
  | 'forbidden'            // P0003 — customers.store_credit.convert manquante
  | 'invalid_points'       // 23514 — points <= 0 ou pas multiple de 100
  | 'insufficient_points'  // P0010
  | 'customer_not_found'   // P0002
  | 'fiscal_closed'
  | 'unknown';

export class ConvertStoreCreditError extends FinancialAttemptError {
  constructor(public code: ConvertErrorCode, message?: string, definitive = false) {
    super(message ?? code, definitive);
  }
}

export interface ConvertLoyaltyArgs {
  customerId:     string;
  points:         number;
  idempotencyKey: string;
  sessionGuard?: () => boolean;
}

export interface ConvertLoyaltyResult {
  ledger_id:         string;
  customer_id:       string;
  points_converted:  number;
  amount:            number;
  balance_after:     number;
  expires_at:        string | null;
  actor_id: string;
  idempotency_key: string;
  idempotent_replay: boolean;
}

function classify(code: string | undefined, message: string): ConvertErrorCode {
  if (code === 'P0004' && /^(period_locked|period_undefined):/.test(message)) return 'fiscal_closed';
  if (code === 'P0003') return 'forbidden';
  if (code === 'P0010') return 'insufficient_points';
  if (code === 'P0002') return 'customer_not_found';
  if (code === '23514') return 'invalid_points';
  if (message.toLowerCase().includes('fiscal')) return 'fiscal_closed';
  return 'unknown';
}

export function useConvertLoyaltyToStoreCredit() {
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    meta: { errorHandled: true },
    onMutate: () => captureFinancialSession(),
    mutationFn: async (args: ConvertLoyaltyArgs): Promise<ConvertLoyaltyResult> => {
      const session = captureFinancialSession();
      const assertSession = () => {
        if (!session.current() || args.sessionGuard?.() === false) {
          throw new ConvertStoreCreditError('unknown', 'Your session changed. Reopen this form.');
        }
      };
      assertSession();
      const { data, error } = await supabase.rpc('convert_loyalty_to_store_credit_v2', {
        p_customer_id: args.customerId,
        p_points: args.points,
        p_idempotency_key: args.idempotencyKey,
      });
      assertSession();
      if (error) throw new ConvertStoreCreditError(classify(error.code, error.message), error.message,
        conversionDefinitiveFailure(error.code, error.message));
      if (!validConversionResult(data, args, session.profileId)) {
        throw new ConvertStoreCreditError('unknown', 'The conversion response could not confirm this attempt. Its result is unconfirmed.');
      }
      return data;
    },
    onSuccess: async (_data, args, session) => {
      if (!session?.current() || args.sessionGuard?.() === false) return;
      const customerId = args.customerId;
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['customer-detail', customerId] }),
        qc.invalidateQueries({ queryKey: LOYALTY_CUSTOMERS_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: ['customers'] }),
        qc.invalidateQueries({ queryKey: storeCreditHistoryKey(customerId) }),
        qc.invalidateQueries({ queryKey: loyaltyHistoryKey(customerId) }),
      ]);
    },
  });
}

export function conversionDefinitiveFailure(code: string, message: string): boolean {
  const rules: Record<string, RegExp> = {
    P0001: /^(Not authenticated|No user profile for caller)$/,
    P0003: /^Permission denied: customers\.store_credit\.convert required$/,
    P0002: /^Customer [\da-f-]+ not found$/i,
    P0010: /^Insufficient loyalty points \(balance: \d+\)$/,
    '23514': /^(Points to convert must be a positive multiple of 100|idempotency_key_required)$/,
    P0004: /^(period_locked|period_undefined):/,
  };
  return rules[code]?.test(message) === true;
}

export function validConversionResult(data: unknown, args: ConvertLoyaltyArgs, profileId: string | undefined): data is ConvertLoyaltyResult {
  return isRecord(data) && identifier(data.ledger_id) && data.customer_id === args.customerId
    && Boolean(profileId) && data.actor_id === profileId && data.idempotency_key === args.idempotencyKey
    && data.points_converted === args.points && data.amount === args.points * 10
    && finite(data.balance_after) && data.balance_after >= 0
    && (data.expires_at === null || (typeof data.expires_at === 'string' && Number.isFinite(Date.parse(data.expires_at))))
    && typeof data.idempotent_replay === 'boolean';
}
