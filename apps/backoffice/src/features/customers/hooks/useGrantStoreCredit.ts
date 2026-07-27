// apps/backoffice/src/features/customers/hooks/useGrantStoreCredit.ts
// ADR-013 Lot 4 (D6) — accord d'avoir manager. La mutation minte le nonce PIN
// (scope store_credit_grant, single-use, TTL 60 s) PUIS appelle
// grant_store_credit_v1 dans la même tentative : un échec RPC brûle le nonce,
// la tentative suivante re-minte. Idempotence métier via p_idempotency_key
// (une clé par ouverture de modal — replay = succès idempotent_replay).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { mintStoreCreditAuthorization } from './useMintStoreCreditAuthorization.js';
import { storeCreditHistoryKey } from './useStoreCreditHistory.js';

export type GrantErrorCode =
  | 'wrong_pin'          // EF 400/401 — PIN invalide
  | 'pin_forbidden'      // EF 403 / RPC P0003 — manager sans customers.store_credit.grant, ou nonce brûlé/expiré
  | 'rate_limited'       // EF 429
  | 'invalid_input'      // RPC 23514 — montant <= 0 ou motif hors 3-500 chars
  | 'customer_not_found' // RPC P0002
  | 'fiscal_closed'      // période fiscale clôturée
  | 'unknown';

export class GrantStoreCreditError extends Error {
  constructor(public code: GrantErrorCode, message?: string) {
    super(message ?? code);
  }
}

export interface GrantStoreCreditArgs {
  customerId:     string;
  amount:         number;
  reason:         string;
  managerPin:     string;
  idempotencyKey: string;
}

export interface GrantStoreCreditResult {
  ledger_id:         string;
  customer_id:       string;
  amount:            number;
  balance_after:     number;
  expires_at:        string | null;
  idempotent_replay?: boolean;
}

function classifyMint(status: number): GrantErrorCode {
  if (status === 429) return 'rate_limited';
  if (status === 403) return 'pin_forbidden';
  return 'wrong_pin';
}

function classifyRpc(code: string | undefined, message: string): GrantErrorCode {
  if (code === 'P0003') return 'pin_forbidden';
  if (code === 'P0002') return 'customer_not_found';
  if (code === '23514') return 'invalid_input';
  if (message.toLowerCase().includes('fiscal')) return 'fiscal_closed';
  return 'unknown';
}

export function useGrantStoreCredit() {
  const qc = useQueryClient();
  return useMutation<GrantStoreCreditResult, GrantStoreCreditError, GrantStoreCreditArgs>({
    mutationFn: async ({ customerId, amount, reason, managerPin, idempotencyKey }) => {
      let authorizationId: string;
      try {
        authorizationId = await mintStoreCreditAuthorization(managerPin);
      } catch (err) {
        const status = (err as { status?: number }).status ?? 0;
        throw new GrantStoreCreditError(classifyMint(status), (err as Error).message);
      }
      const { data, error } = await supabase.rpc('grant_store_credit_v1', {
        p_customer_id: customerId,
        p_amount: amount,
        p_reason: reason,
        p_authorization_id: authorizationId,
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw new GrantStoreCreditError(classifyRpc(error.code, error.message), error.message);
      return data as unknown as GrantStoreCreditResult;
    },
    onSuccess: async (_data, { customerId }) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['customer-detail', customerId] }),
        qc.invalidateQueries({ queryKey: storeCreditHistoryKey(customerId) }),
      ]);
    },
  });
}
