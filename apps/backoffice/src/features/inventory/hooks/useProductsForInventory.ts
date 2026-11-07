// apps/backoffice/src/features/inventory/hooks/useProductsForInventory.ts
//
// Typeahead helper for inventory modals. Returns the products matching a
// case-insensitive name fragment (limit 20). Disabled until the user types
// at least 2 characters to keep the round-trip cost predictable.

import { useQuery } from '@tanstack/react-query';
import { getOperationalProducts } from '@/lib/operationalProducts.js';

export interface ProductTypeaheadRow {
  id:             string;
  sku:            string;
  name:           string;
  current_stock:  number | null;
  unit:           string | null;
}

export function useProductsForInventory(search: string) {
  const term = search.trim().slice(0, 64);
  return useQuery<ProductTypeaheadRow[]>({
    queryKey: ['products-typeahead', term] as const,
    enabled:  term.length >= 2,
    staleTime: 30_000,
    queryFn: async () => {
      const match = term.toLowerCase();
      return (await getOperationalProducts()).filter((p) => p.track_inventory &&
        (p.name.toLowerCase().includes(match) || p.sku.toLowerCase().includes(match)))
        .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 20);
    },
  });
}
