// apps/backoffice/src/features/customers/hooks/useStoreCreditHistory.ts
// ADR-013 Lot 4 — historique d'avoir d'un client. Lecture PostgREST directe du
// ledger append-only `customer_store_credit_ledger` (RLS resserrée _243 :
// customers.read requis — même gate que la table customers). Miroir de
// useCustomerLoyaltyHistory.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export type StoreCreditSource =
  | 'refund'
  | 'manager_grant'
  | 'loyalty_conversion'
  | 'expiry'
  | 'spend';

export interface StoreCreditLedgerRow {
  id:             string;
  customer_id:    string;
  delta:          number;
  balance_after:  number;
  source:         StoreCreditSource;
  reference_type: string | null;
  reference_id:   string | null;
  expires_at:     string | null;
  created_at:     string;
  created_by:     string | null;
  author:         { id: string; full_name: string } | null;
}

export const storeCreditHistoryKey = (customerId: string) =>
  ['store-credit-history', customerId] as const;

export function useStoreCreditHistory(customerId: string | null) {
  return useQuery<StoreCreditLedgerRow[]>({
    queryKey: customerId ? storeCreditHistoryKey(customerId) : ['store-credit-history', 'noop'] as const,
    enabled: customerId !== null,
    staleTime: 60_000,
    queryFn: async () => {
      if (customerId === null) return [];
      const { data, error } = await supabase
        .from('customer_store_credit_ledger')
        .select(`
          id, customer_id, delta, balance_after, source,
          reference_type, reference_id, expires_at, created_at, created_by,
          author:user_profiles!customer_store_credit_ledger_created_by_fkey(id, full_name)
        `)
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      // PostgREST peut renvoyer la relation to-one en objet ou tableau — normalise.
      return (data ?? []).map((row) => {
        const rawAuthor = (row as Record<string, unknown>).author;
        const author = (Array.isArray(rawAuthor) ? (rawAuthor as unknown[])[0] : rawAuthor) ?? null;
        return { ...(row as unknown as StoreCreditLedgerRow), author: author as StoreCreditLedgerRow['author'] };
      });
    },
  });
}
