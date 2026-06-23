// apps/backoffice/src/features/accounting/hooks/useCashWallets.ts
// Cash Wallets module — wraps get_cash_wallet_balances_v1 RPC.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface WalletBalance {
  account_code: string;
  account_name: string;
  balance: number;
}

export const CASH_WALLETS_KEY = ['accounting', 'cash-wallets'] as const;

export function useCashWallets() {
  return useQuery<WalletBalance[]>({
    queryKey: CASH_WALLETS_KEY,
    staleTime: 30_000,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase.rpc('get_cash_wallet_balances_v1', {} as any);
      if (error !== null) throw new Error(error.message);
      return (data ?? []) as WalletBalance[];
    },
  });
}
