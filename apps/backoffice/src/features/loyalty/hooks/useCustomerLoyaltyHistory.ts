// apps/backoffice/src/features/loyalty/hooks/useCustomerLoyaltyHistory.ts
//
// Last 50 ledger entries for a single customer; joins the user_profiles
// row that authored each entry so the drawer can show "Adjusted by Alice".

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface LoyaltyTxnRow {
  id:                   string;
  customer_id:          string;
  order_id:             string | null;
  transaction_type:     'earn' | 'redeem' | 'adjust' | 'refund';
  points:               number;
  points_balance_after: number;
  order_amount:         number | null;
  description:          string;
  created_at:           string;
  created_by:           string | null;
  author:               { id: string; full_name: string } | null;
}

export const loyaltyHistoryKey = (customerId: string) => ['loyalty-history', customerId] as const;

export function useCustomerLoyaltyHistory(customerId: string | null) {
  return useQuery<LoyaltyTxnRow[]>({
    queryKey: customerId ? loyaltyHistoryKey(customerId) : ['loyalty-history', 'noop'] as const,
    enabled: customerId !== null,
    queryFn: async () => {
      if (customerId === null) return [];
      const { data, error } = await supabase
        .from('loyalty_transactions')
        .select(`
          id, customer_id, order_id, transaction_type, points,
          points_balance_after, order_amount, description,
          created_at, created_by,
          author:user_profiles!loyalty_transactions_created_by_fkey(id, full_name)
        `)
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as LoyaltyTxnRow[];
    },
  });
}
