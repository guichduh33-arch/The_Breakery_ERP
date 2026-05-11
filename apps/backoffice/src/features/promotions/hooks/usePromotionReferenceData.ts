// apps/backoffice/src/features/promotions/hooks/usePromotionReferenceData.ts
//
// Bundles the lookup queries used by <PromotionForm> into one hook so the
// modal can render once everything is ready (avoids flashing empty selects).
//
// Spec ref: docs/superpowers/specs/2026-05-10-session-9-promotions-spec.md §4.5

import { useQuery } from '@tanstack/react-query';
import type { PromotionFormOption } from '@breakery/ui';
import { supabase } from '@/lib/supabase.js';

interface ReferenceData {
  products: PromotionFormOption[];
  categories: PromotionFormOption[];
  customerCategories: PromotionFormOption[];
  customerTiers: PromotionFormOption[];
}

export function usePromotionReferenceData() {
  return useQuery<ReferenceData>({
    queryKey: ['promotions-bo', 'reference-data'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      // `loyalty_tiers` is not a table in the current schema — tier-based
      // restrictions are deferred. The `customer_tier_ids` column on `promotions`
      // stays for forward-compatibility but the form returns no options today.
      const [products, categories, customerCategories] = await Promise.all([
        supabase
          .from('products')
          .select('id, name, sku')
          .is('deleted_at', null)
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('categories')
          .select('id, name, slug')
          .eq('is_active', true)
          .order('sort_order'),
        supabase
          .from('customer_categories')
          .select('id, name, slug')
          .order('name'),
      ]);

      if (products.error) throw products.error;
      if (categories.error) throw categories.error;
      if (customerCategories.error) throw customerCategories.error;

      return {
        products: (products.data ?? []).map((p) => ({
          id: p.id,
          label: `${p.name} (${p.sku})`,
        })),
        categories: (categories.data ?? []).map((c) => ({
          id: c.id,
          label: c.name,
        })),
        customerCategories: (customerCategories.data ?? []).map((c) => ({
          id: c.id,
          label: c.name,
        })),
        customerTiers: [],
      };
    },
  });
}
