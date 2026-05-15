// apps/backoffice/src/features/loyalty/hooks/useLoyaltyStats.ts
//
// Session 14 / Phase 5.B — KPI tiles for the Loyalty page header.
// Aggregates members count, total points outstanding, lifetime points,
// and average tier from the active retail customer set.

import { useQuery } from '@tanstack/react-query';
import { tierFromLifetime } from '@breakery/domain';
import { supabase } from '@/lib/supabase.js';

export interface LoyaltyStats {
  members:        number;
  totalPoints:    number;
  lifetimePoints: number;
  bronze:         number;
  silver:         number;
  gold:           number;
  platinum:       number;
}

export const LOYALTY_STATS_QUERY_KEY = ['loyalty-stats-bo'] as const;

export function useLoyaltyStats() {
  return useQuery<LoyaltyStats>({
    queryKey: LOYALTY_STATS_QUERY_KEY,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('loyalty_points, lifetime_points')
        .is('deleted_at', null)
        .eq('customer_type', 'retail');
      if (error) throw error;
      const rows = (data ?? []) as Array<{ loyalty_points: number; lifetime_points: number }>;
      let totalPoints = 0;
      let lifetimePoints = 0;
      let bronze = 0;
      let silver = 0;
      let gold = 0;
      let platinum = 0;
      for (const r of rows) {
        totalPoints   += r.loyalty_points  ?? 0;
        lifetimePoints += r.lifetime_points ?? 0;
        const tier = tierFromLifetime(r.lifetime_points ?? 0);
        if (tier === 'silver') silver += 1;
        else if (tier === 'gold') gold += 1;
        else if (tier === 'platinum') platinum += 1;
        else bronze += 1;
      }
      return {
        members: rows.length,
        totalPoints,
        lifetimePoints,
        bronze, silver, gold, platinum,
      };
    },
  });
}
