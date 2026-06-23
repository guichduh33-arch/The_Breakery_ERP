// apps/backoffice/src/features/accounting/hooks/useRecordCashMovement.ts
// Cash Wallets module — wraps record_cash_wallet_movement_v1 RPC.
// Idempotency key is a useRef UUID, reset on successful mutation so each
// new form submit gets a fresh key while retries within the same attempt reuse it.
import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { CASH_WALLETS_KEY } from './useCashWallets.js';
import { CASH_WALLET_LEDGER_KEY } from './useCashWalletLedger.js';

export type CashMovementType =
  | 'undepo_to_petty'
  | 'petty_to_undepo'
  | 'bank_deposit'
  | 'boss_withdrawal'
  | 'small_money_lend'
  | 'small_money_repay'
  | 'adjustment_gain'
  | 'adjustment_loss';

export interface RecordCashMovementInput {
  movementType:  CashMovementType;
  amount:        number;
  movementDate:  string;                          // ISO date YYYY-MM-DD
  remark:        string;
  walletCode?:   '1110' | '1111' | '1117' | null; // required for adjustments
}

export function useRecordCashMovement() {
  const qc = useQueryClient();
  const idemKey = useRef<string>(crypto.randomUUID());

  return useMutation({
    mutationFn: async (input: RecordCashMovementInput) => {
      const { data, error } = await supabase.rpc('record_cash_wallet_movement_v1', {
        p_movement_type:   input.movementType,
        p_amount:          input.amount,
        p_movement_date:   input.movementDate,
        p_remark:          input.remark,
        p_idempotency_key: idemKey.current,
        ...(input.walletCode != null ? { p_wallet_code: input.walletCode } : {}),
      });
      if (error !== null) throw new Error(error.message);
      return data as string; // journal_entry_id (UUID)
    },
    onSuccess: () => {
      idemKey.current = crypto.randomUUID(); // fresh key for the next distinct movement
      qc.invalidateQueries({ queryKey: CASH_WALLETS_KEY });
      qc.invalidateQueries({ queryKey: CASH_WALLET_LEDGER_KEY });
    },
  });
}
