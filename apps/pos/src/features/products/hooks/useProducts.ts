import { useQuery } from '@tanstack/react-query';
import type { Product, DispatchStation } from '@breakery/domain';
import { getOperationalProducts } from '@/lib/operationalProducts';
import { useSaleQueryEnabled } from '@/features/lan/hooks/useSaleQueryEnabled';

export function useProducts() {
  const enabled = useSaleQueryEnabled();
  return useQuery({ enabled, queryKey: ['products'],
    queryFn: async (): Promise<Product[]> => {
      const products = await getOperationalProducts();
      return products.filter((p) => p.parent_product_id === null && p.is_active && p.visible_on_pos)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ ...p,
          dispatch_station: (p.categories?.dispatch_station ?? 'none') as DispatchStation,
          // La disponibilité vient du serveur sans révéler les quantités.
          is_sellable: p.is_sellable, has_variants: p.has_variants,
        } as unknown as Product));
    },
  });
}
