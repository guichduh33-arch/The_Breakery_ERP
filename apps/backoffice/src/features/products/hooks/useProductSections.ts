// apps/backoffice/src/features/products/hooks/useProductSections.ts
//
// Reads the product_sections rows for one product (which production stations /
// sections it belongs to, and which one is primary). Powers the Stations panel
// in the product editor — the assignment that the redesigned Production page
// filters on (strict per-station product lists).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface ProductSectionLink {
  section_id: string;
  is_primary: boolean;
}

export const productSectionsKey = (productId: string) =>
  ['product-sections', productId] as const;

export function useProductSections(productId: string | null) {
  return useQuery<ProductSectionLink[]>({
    queryKey: productSectionsKey(productId ?? ''),
    enabled: productId !== null,
    staleTime: 60_000,
    queryFn: async (): Promise<ProductSectionLink[]> => {
      const { data, error } = await supabase
        .from('product_sections')
        .select('section_id, is_primary')
        .eq('product_id', productId as string);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        section_id: r.section_id as string,
        is_primary: r.is_primary as boolean,
      }));
    },
  });
}
