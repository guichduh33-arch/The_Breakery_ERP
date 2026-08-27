// apps/backoffice/src/features/loyalty/hooks/useLoyaltyCustomersList.ts
//
// React Query hook for the BO loyalty customer list. Server-side filters
// (search + tier range) keep the round-trip small even on big customer sets.
// Mirrors the promotions list hook in shape.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface CustomerListRow {
  id:               string;
  name:             string;
  phone:            string | null;
  email:            string | null;
  loyalty_points:   number;
  lifetime_points:  number;
  total_spent:      number;
  total_visits:     number;
  last_visit_at:    string | null;
  created_at:       string;
}

export type TierFilter = 'all' | 'bronze' | 'silver' | 'gold' | 'platinum';

export interface LoyaltyCustomersFilters {
  search?: string;
  tier?:   TierFilter;
}

export const LOYALTY_CUSTOMERS_QUERY_KEY = ['loyalty-customers'] as const;

/**
 * Borne HAUTE de la requête — même geste et même valeur que
 * `CUSTOMERS_FETCH_CAP` (liste clients). Sans elle, l'écran descendait toute la
 * base retail filtrée, un jeu sans plafond côté serveur. La page N'A PAS de
 * pagination : elle annonce donc la troncature sous la table quand la borne est
 * touchée, plutôt que de laisser croire à une liste complète.
 */
export const LOYALTY_FETCH_CAP = 500;

const TIER_RANGES: Record<Exclude<TierFilter, 'all'>, { min: number; max: number | null }> = {
  bronze:   { min: 0,    max: 499  },
  silver:   { min: 500,  max: 1999 },
  gold:     { min: 2000, max: 4999 },
  platinum: { min: 5000, max: null },
};

const SELECT_COLS = [
  'id','name','phone','email',
  'loyalty_points','lifetime_points','total_spent','total_visits','last_visit_at',
  'created_at',
].join(', ');

// PostgREST `.or()` syntax uses `,()` as filter separators and group delimiters,
// `*` as wildcard, `%` and `_` as ilike metacharacters. A user-typed `(` or `,`
// in the search box breaks the filter and surfaces as a 400. Strip the
// metacharacters before interpolation. Names/phones don't legitimately contain
// any of `(),*%_\` so removing them is safe.
const OR_FILTER_UNSAFE = /[,()*%_\\]/g;
function sanitizeSearchTerm(term: string): string {
  return term.replace(OR_FILTER_UNSAFE, '').slice(0, 64);
}

export function useLoyaltyCustomersList(filters: LoyaltyCustomersFilters = {}) {
  return useQuery<CustomerListRow[]>({
    queryKey: [...LOYALTY_CUSTOMERS_QUERY_KEY, filters] as const,
    staleTime: 60_000,
    queryFn: async () => {
      let q = supabase
        .from('customers')
        .select(SELECT_COLS)
        .is('deleted_at', null)
        .eq('customer_type', 'retail')
        .order('loyalty_points', { ascending: false })
        .order('name', { ascending: true });

      if (filters.search !== undefined && filters.search.trim() !== '') {
        const term = sanitizeSearchTerm(filters.search.trim());
        if (term !== '') {
          q = q.or(`name.ilike.%${term}%,phone.ilike.${term}%`);
        }
      }
      if (filters.tier !== undefined && filters.tier !== 'all') {
        const range = TIER_RANGES[filters.tier];
        q = q.gte('lifetime_points', range.min);
        if (range.max !== null) q = q.lte('lifetime_points', range.max);
      }

      // Après le tri : la tranche rendue est la tête du classement (plus gros
      // soldes de points), pas un échantillon arbitraire.
      q = q.limit(LOYALTY_FETCH_CAP);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as CustomerListRow[];
    },
  });
}
