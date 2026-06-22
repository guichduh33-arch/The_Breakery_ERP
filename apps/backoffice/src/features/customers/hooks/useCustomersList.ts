// apps/backoffice/src/features/customers/hooks/useCustomersList.ts
//
// Session 14 / Phase 5.B — BO Customers list hook.
//
// Returns ALL customers (retail + b2b) with category info joined for the
// new Customers BO surface. Mirrors useLoyaltyCustomersList shape but does
// not filter by customer_type and adds category metadata for the badge.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface CustomersListRow {
  id:                  string;
  name:                string;
  phone:               string | null;
  email:               string | null;
  customer_type:       'retail' | 'b2b';
  loyalty_points:      number;
  lifetime_points:     number;
  total_spent:         number;
  total_visits:        number;
  last_visit_at:       string | null;
  category_id:         string | null;
  category_slug:       string | null;
  category_name:       string | null;
  b2b_current_balance: number;
  created_at:          string;
}

export type CustomersSort = 'last_visit' | 'name' | 'spend' | 'points';
export type CustomersTier = 'all' | 'bronze' | 'silver' | 'gold' | 'platinum';

export interface CustomersListFilters {
  search?:     string;
  categoryId?: string | null;
  tier?:       CustomersTier;
  sort?:       CustomersSort;
}

export const CUSTOMERS_LIST_QUERY_KEY = ['customers-list-bo'] as const;

const TIER_RANGES: Record<Exclude<CustomersTier, 'all'>, { min: number; max: number | null }> = {
  bronze:   { min: 0,    max: 499  },
  silver:   { min: 500,  max: 1999 },
  gold:     { min: 2000, max: 4999 },
  platinum: { min: 5000, max: null },
};

// Same scrubbing rationale as useLoyaltyCustomersList — PostgREST .or() is
// metacharacter-sensitive.
const OR_FILTER_UNSAFE = /[,()*%_\\]/g;
function sanitizeSearchTerm(term: string): string {
  return term.replace(OR_FILTER_UNSAFE, '').slice(0, 64);
}

const SELECT_COLS = `
  id, name, phone, email, customer_type,
  loyalty_points, lifetime_points, total_spent, total_visits, last_visit_at,
  category_id, b2b_current_balance, created_at,
  customer_categories!left(id, name, slug)
`.replace(/\s+/g, ' ').trim();

interface RawCategoryJoin {
  id:   string;
  name: string;
  slug: string;
}
interface RawCustomerRow {
  id:                  string;
  name:                string;
  phone:               string | null;
  email:               string | null;
  customer_type:       'retail' | 'b2b';
  loyalty_points:      number;
  lifetime_points:     number;
  total_spent:         number;
  total_visits:        number;
  last_visit_at:       string | null;
  category_id:         string | null;
  b2b_current_balance: number;
  created_at:          string;
  customer_categories: RawCategoryJoin | RawCategoryJoin[] | null;
}

function pickCategory(raw: RawCustomerRow['customer_categories']): RawCategoryJoin | null {
  if (raw === null) return null;
  if (Array.isArray(raw)) return raw.length > 0 ? raw[0] ?? null : null;
  return raw;
}

export function useCustomersList(filters: CustomersListFilters = {}) {
  return useQuery<CustomersListRow[]>({
    queryKey: [...CUSTOMERS_LIST_QUERY_KEY, filters] as const,
    staleTime: 60_000,
    queryFn: async () => {
      let q = supabase
        .from('customers')
        .select(SELECT_COLS)
        .is('deleted_at', null);

      if (filters.search !== undefined && filters.search.trim() !== '') {
        const term = sanitizeSearchTerm(filters.search.trim());
        if (term !== '') {
          q = q.or(`name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`);
        }
      }
      if (filters.categoryId !== undefined && filters.categoryId !== null && filters.categoryId !== '') {
        q = q.eq('category_id', filters.categoryId);
      }
      if (filters.tier !== undefined && filters.tier !== 'all') {
        const range = TIER_RANGES[filters.tier];
        q = q.gte('lifetime_points', range.min);
        if (range.max !== null) q = q.lte('lifetime_points', range.max);
      }

      const sort = filters.sort ?? 'last_visit';
      if (sort === 'last_visit') {
        q = q.order('last_visit_at', { ascending: false, nullsFirst: false }).order('name');
      } else if (sort === 'name') {
        q = q.order('name', { ascending: true });
      } else if (sort === 'spend') {
        q = q.order('total_spent', { ascending: false }).order('name');
      } else {
        q = q.order('loyalty_points', { ascending: false }).order('name');
      }

      const { data, error } = await q;
      if (error) throw error;

      return ((data ?? []) as unknown as RawCustomerRow[]).map((r) => {
        const cat = pickCategory(r.customer_categories);
        return {
          id:                  r.id,
          name:                r.name,
          phone:               r.phone,
          email:               r.email,
          customer_type:       r.customer_type,
          loyalty_points:      r.loyalty_points,
          lifetime_points:     r.lifetime_points,
          total_spent:         Number(r.total_spent),
          total_visits:        r.total_visits,
          last_visit_at:       r.last_visit_at,
          category_id:         r.category_id,
          category_slug:       cat === null ? null : cat.slug,
          category_name:       cat === null ? null : cat.name,
          b2b_current_balance: Number(r.b2b_current_balance),
          created_at:          r.created_at,
        };
      });
    },
  });
}
