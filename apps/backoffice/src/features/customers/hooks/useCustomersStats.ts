// apps/backoffice/src/features/customers/hooks/useCustomersStats.ts
//
// Session 14 / Phase 5.B — KPI tiles for the Customers list header.
//
// Counts derived client-side from a slim aggregate query. Re-uses the
// `customers` table; no RPC needed.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface CustomersStats {
  totalCustomers:   number;
  activeThisMonth:  number;
  loyaltyMembers:   number;
  loyaltyPercent:   number;
  outstandingB2b:   number;
  outstandingCount: number;
}

export const CUSTOMERS_STATS_QUERY_KEY = ['customers-stats-bo'] as const;

interface AggRow {
  customer_type:       'retail' | 'b2b';
  loyalty_points:      number;
  lifetime_points:     number;
  last_visit_at:       string | null;
  b2b_current_balance: number;
}

function startOfMonthIso(): string {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return first.toISOString();
}

export function useCustomersStats() {
  return useQuery<CustomersStats>({
    queryKey: CUSTOMERS_STATS_QUERY_KEY,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('customer_type, loyalty_points, lifetime_points, last_visit_at, b2b_current_balance')
        .is('deleted_at', null);
      if (error) throw error;
      const rows = (data ?? []) as AggRow[];
      const monthStart = startOfMonthIso();
      let total = 0;
      let activeMonth = 0;
      let loyaltyMembers = 0;
      let outstanding = 0;
      let outstandingCount = 0;
      for (const r of rows) {
        total += 1;
        if (r.last_visit_at !== null && r.last_visit_at >= monthStart) activeMonth += 1;
        if ((r.lifetime_points ?? 0) > 0 || (r.loyalty_points ?? 0) > 0) loyaltyMembers += 1;
        const bal = Number(r.b2b_current_balance ?? 0);
        if (bal > 0) {
          outstanding += bal;
          outstandingCount += 1;
        }
      }
      const loyaltyPercent = total === 0 ? 0 : Math.round((loyaltyMembers / total) * 100);
      return {
        totalCustomers:   total,
        activeThisMonth:  activeMonth,
        loyaltyMembers,
        loyaltyPercent,
        outstandingB2b:   outstanding,
        outstandingCount,
      };
    },
  });
}
