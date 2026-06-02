// apps/backoffice/src/features/products/hooks/useProductDisplayStock.ts
//
// M7 audit fix — reads the vitrine counter for a single display-case product so
// the product detail page can warn when a flagged product has not yet been
// stocked from the POS (qty 0 or no row → unsellable at checkout).
//
// RLS gates SELECT on `display.read`; a caller without it gets a query error
// which the consumer treats as "unknown" (still shows the generic warning).
// Display stock is mutated from the POS side only — this hook is read-only.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export function useProductDisplayStock(productId: string | null, enabled: boolean) {
  return useQuery<number | null>({
    queryKey: ['display-stock', 'product', productId ?? ''] as const,
    enabled: enabled && productId !== null && productId !== '',
    staleTime: 15_000,
    queryFn: async () => {
      if (productId === null || productId === '') return null;
      const { data, error } = await supabase
        .from('display_stock')
        .select('quantity')
        .eq('product_id', productId)
        .maybeSingle();
      if (error) throw error;
      // No row yet (trigger not fired, or unsaved draft) → null = "not stocked".
      return data === null ? null : Number(data.quantity);
    },
  });
}
