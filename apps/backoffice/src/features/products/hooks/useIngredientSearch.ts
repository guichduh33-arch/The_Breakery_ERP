// apps/backoffice/src/features/products/hooks/useIngredientSearch.ts
//
// Session 15 / Phase 3.A — IngredientPicker query hook.
//
// Wraps `search_ingredients_v1` (DB RPC) for autocomplete usage. The hook
// itself is debounce-free — debouncing is the caller's concern (the
// `IngredientPicker` component owns its own 200ms debounce). The hook only
// short-circuits single-character queries via the `enabled` flag.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { IngredientKind, IngredientSearchResult } from '@breakery/ui';

const DEFAULT_LIMIT = 20;

export function useIngredientSearch(
  query: string,
  kind: IngredientKind = 'all',
  opts?: { limit?: number },
) {
  const trimmed = query.trim();
  const limit = opts?.limit ?? DEFAULT_LIMIT;

  return useQuery<IngredientSearchResult[]>({
    queryKey: ['ingredient-search', trimmed, kind, limit] as const,
    // Skip single-char queries ; empty is allowed so the picker can show
    // a "browse all" mode when the user simply focuses the field.
    enabled: trimmed.length === 0 || trimmed.length >= 2,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_ingredients_v1', {
        p_query: trimmed,
        p_kind:  kind,
        p_limit: limit,
      });
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({
        product_id:    r.product_id as string,
        sku:           r.sku as string,
        name:          r.name as string,
        unit:          r.unit as string,
        cost_price:    Number(r.cost_price),
        current_stock: Number(r.current_stock),
        kind:          (r.kind as IngredientSearchResult['kind']),
        has_recipe:    Boolean(r.has_recipe),
      }));
    },
  });
}
