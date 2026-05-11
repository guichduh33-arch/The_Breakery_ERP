// apps/backoffice/src/features/promotions/hooks/usePromotionsList.ts
//
// React Query hook for the backoffice promotions list. Returns active and
// soft-deleted promos so the page can let admins toggle `is_active` in place
// without losing context. Soft-deleted rows are excluded.
//
// Spec ref: docs/superpowers/specs/2026-05-10-session-9-promotions-spec.md §4.5

import { useQuery } from '@tanstack/react-query';
import type { PromotionFormValues } from '@breakery/ui';
import { supabase } from '@/lib/supabase.js';

export interface PromotionListRow extends PromotionFormValues {
  id: string;
  created_at: string;
}

export interface PromotionsListFilters {
  type?: 'percentage' | 'fixed_amount' | 'bogo' | 'free_product' | 'all';
  active?: 'all' | 'active' | 'inactive';
  startDate?: string | null;
  endDate?: string | null;
}

export const PROMOTIONS_QUERY_KEY = ['promotions-bo'] as const;

const SELECT_COLS = [
  'id',
  'name',
  'slug',
  'description',
  'type',
  'scope',
  'discount_value',
  'max_discount_amount',
  'scope_product_ids',
  'scope_category_ids',
  'bogo_trigger_product_ids',
  'bogo_reward_product_ids',
  'bogo_trigger_qty',
  'bogo_reward_qty',
  'bogo_reward_discount_pct',
  'gift_product_id',
  'gift_qty',
  'min_items_total',
  'customer_category_ids',
  'customer_tier_ids',
  'start_at',
  'end_at',
  'day_of_week_mask',
  'start_hour',
  'end_hour',
  'priority',
  'stackable_with_promo',
  'stackable_with_manual',
  'is_active',
  'created_at',
].join(', ');

export function usePromotionsList(filters: PromotionsListFilters = {}) {
  return useQuery<PromotionListRow[]>({
    queryKey: [...PROMOTIONS_QUERY_KEY, filters] as const,
    queryFn: async () => {
      let q = supabase
        .from('promotions')
        .select(SELECT_COLS)
        .is('deleted_at', null)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false });

      if (filters.type !== undefined && filters.type !== 'all') {
        q = q.eq('type', filters.type);
      }
      if (filters.active === 'active') q = q.eq('is_active', true);
      if (filters.active === 'inactive') q = q.eq('is_active', false);
      if (filters.startDate !== undefined && filters.startDate !== null && filters.startDate !== '') {
        q = q.gte('created_at', filters.startDate);
      }
      if (filters.endDate !== undefined && filters.endDate !== null && filters.endDate !== '') {
        q = q.lte('created_at', filters.endDate);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as PromotionListRow[];
    },
  });
}
