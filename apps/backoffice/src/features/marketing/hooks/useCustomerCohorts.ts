// apps/backoffice/src/features/marketing/hooks/useCustomerCohorts.ts
//
// Wraps `get_customer_cohort_v1(p_cohort_month, p_lookback_months)` RPC.
// Returns retention/revenue buckets for the cohort that signed up in the
// given month.
//
// Session 13 / Phase 6.B.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface CohortBucket {
  cohort_month:         string; // ISO date (first day of cohort month)
  months_since_signup:  number;
  retained_customers:   number;
  total_revenue:        number;
  retention_pct:        number;
}

export const COHORT_QUERY_KEY = ['marketing', 'cohort'] as const;

export function useCustomerCohorts(cohortMonth: string, lookbackMonths = 12) {
  return useQuery<CohortBucket[]>({
    queryKey: [...COHORT_QUERY_KEY, cohortMonth, lookbackMonths] as const,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_customer_cohort_v1', {
        p_cohort_month:    cohortMonth,
        p_lookback_months: lookbackMonths,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        cohort_month:        String(r.cohort_month),
        months_since_signup: Number(r.months_since_signup),
        retained_customers:  Number(r.retained_customers),
        total_revenue:       Number(r.total_revenue),
        retention_pct:       Number(r.retention_pct),
      }));
    },
  });
}
