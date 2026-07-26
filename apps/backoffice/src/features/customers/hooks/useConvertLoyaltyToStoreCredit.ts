// apps/backoffice/src/features/customers/hooks/useConvertLoyaltyToStoreCredit.ts
// ADR-013 Lot 4 (D6) — conversion points fidélité → avoir (BO seulement,
// permission customers.store_credit.convert vérifiée in-RPC). Taux serveur :
// 1 pt = Rp 10, points par multiples de 100. Idempotence via p_idempotency_key.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { loyaltyHistoryKey } from '@/features/loyalty/hooks/useCustomerLoyaltyHistory.js';
import { storeCreditHistoryKey } from './useStoreCreditHistory.js';

export type ConvertErrorCode =
  | 'forbidden'            // P0003 — customers.store_credit.convert manquante
  | 'invalid_points'       // 23514 — points <= 0 ou pas multiple de 100
  | 'insufficient_points'  // P0010
  | 'customer_not_found'   // P0002
  | 'fiscal_closed'
  | 'unknown';

export class ConvertStoreCreditError extends Error {
  constructor(public code: ConvertErrorCode, message?: string) {
    super(message ?? code);
  }
}

export interface ConvertLoyaltyArgs {
  customerId:     string;
  points:         number;
  idempotencyKey: string;
}

export interface ConvertLoyaltyResult {
  ledger_id:         string;
  customer_id:       string;
  points_converted:  number;
  amount:            number;
  balance_after:     number;
  expires_at:        string | null;
  idempotent_replay?: boolean;
}

function classify(code: string | undefined, message: string): ConvertErrorCode {
  if (code === 'P0003') return 'forbidden';
  if (code === 'P0010') return 'insufficient_points';
  if (code === 'P0002') return 'customer_not_found';
  if (code === '23514') return 'invalid_points';
  if (message.toLowerCase().includes('fiscal')) return 'fiscal_closed';
  return 'unknown';
}

export function useConvertLoyaltyToStoreCredit() {
  const qc = useQueryClient();
  return useMutation<ConvertLoyaltyResult, ConvertStoreCreditError, ConvertLoyaltyArgs>({
    mutationFn: async ({ customerId, points, idempotencyKey }) => {
      const { data, error } = await supabase.rpc('convert_loyalty_to_store_credit_v1', {
        p_customer_id: customerId,
        p_points: points,
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw new ConvertStoreCreditError(classify(error.code, error.message), error.message);
      return data as unknown as ConvertLoyaltyResult;
    },
    onSuccess: async (_data, { customerId }) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['customer-detail', customerId] }),
        qc.invalidateQueries({ queryKey: storeCreditHistoryKey(customerId) }),
        qc.invalidateQueries({ queryKey: loyaltyHistoryKey(customerId) }),
      ]);
    },
  });
}
