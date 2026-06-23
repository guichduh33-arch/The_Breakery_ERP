// apps/backoffice/src/features/accounting/hooks/useCashWalletLedger.ts
// Cash Wallets module — wraps get_cash_wallet_ledger_v2 RPC.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface WalletLedgerRow {
  row_date:    string;
  remark:      string | null;
  category:    string | null;
  description: string | null;
  supplier:    string | null;
  in_amount:   number;
  out_amount:  number;
  saldo:       number;
  ref_type:    string | null;
}

export const CASH_WALLET_LEDGER_KEY = ['accounting', 'cash-wallet-ledger'] as const;

export function useCashWalletLedger(
  accountCode: string | null,
  startDate: string,
  endDate: string,
) {
  return useQuery<WalletLedgerRow[]>({
    queryKey: [...CASH_WALLET_LEDGER_KEY, accountCode, startDate, endDate],
    enabled: !!accountCode,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_cash_wallet_ledger_v2', {
        p_account_code: accountCode as string,
        p_date_start:   startDate,
        p_date_end:     endDate,
      });
      if (error !== null) throw new Error(error.message);
      return (data ?? []) as WalletLedgerRow[];
    },
  });
}
