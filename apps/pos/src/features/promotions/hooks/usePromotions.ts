// apps/pos/src/features/promotions/hooks/usePromotions.ts
//
// Session 9 — fetch active, non-deleted promotions for client-side evaluation.
// Spec ref: 2026-05-10-session-9-promotions-spec.md §4.3 (POS integration), §4.4 (cart auto-eval)
//
// Cache: 5 minutes staleTime — promo updates from the backoffice are pushed
// via realtime (`usePromotionsRealtime`) which invalidates this query key.
import { useQuery } from '@tanstack/react-query';
import type { Promotion } from '@breakery/domain';
import { supabase } from '@/lib/supabase';

export const PROMOTIONS_QUERY_KEY = ['promotions', 'active'] as const;

/** All columns the domain `Promotion` type expects. */
const PROMOTIONS_SELECT =
  'id, name, slug, description, type, scope, ' +
  'discount_value, max_discount_amount, scope_product_ids, scope_category_ids, ' +
  'bogo_trigger_product_ids, bogo_reward_product_ids, bogo_trigger_qty, bogo_reward_qty, bogo_reward_discount_pct, ' +
  'gift_product_id, gift_qty, ' +
  'min_items_total, customer_category_ids, customer_tier_ids, start_at, end_at, day_of_week_mask, start_hour, end_hour, ' +
  'priority, stackable_with_promo, stackable_with_manual, ' +
  'is_active, created_at';

export function usePromotions() {
  return useQuery({
    queryKey: PROMOTIONS_QUERY_KEY,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Promotion[]> => {
      const { data, error } = await supabase
        .from('promotions')
        .select(PROMOTIONS_SELECT)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      // supabase-js parser can't always reconcile a long select string with the
      // generated Row type ; cast through `unknown` exactly like the backoffice
      // `usePromotionsList` (apps/backoffice/.../usePromotionsList.ts).
      return (data ?? []) as unknown as Promotion[];
    },
  });
}
