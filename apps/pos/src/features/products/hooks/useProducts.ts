import { useQuery } from '@tanstack/react-query';
import type { Product, DispatchStation } from '@breakery/domain';
import { getOperationalProducts } from '@/lib/operationalProducts';
import { useSaleQueryEnabled } from '@/features/lan/hooks/useSaleQueryEnabled';

interface SortableProduct { name: string; product_type: string; combo_display_order?: number | null }

/**
 * S3-13 — L'ordre d'affichage des combos saisi au back-office
 * (`products.combo_display_order`) prime sur le nom. La liste arrive triée par
 * nom ; les emplacements occupés par des combos sont remplis par les combos
 * triés (ordre croissant, puis nom). Les autres produits gardent leur place :
 * l'onglet Combos, une catégorie mixte, les favoris ou la recherche (tous des
 * filtres qui conservent l'ordre relatif) respectent donc le même ordre.
 */
export function applyComboDisplayOrder<T extends SortableProduct>(sortedByName: T[]): T[] {
  const combos = sortedByName
    .filter((p) => p.product_type === 'combo')
    .sort((a, b) =>
      (a.combo_display_order ?? 0) - (b.combo_display_order ?? 0) || a.name.localeCompare(b.name));
  let next = 0;
  return sortedByName.map((p) => (p.product_type === 'combo' ? (combos[next++] ?? p) : p));
}

export function useProducts() {
  const enabled = useSaleQueryEnabled();
  return useQuery({ enabled, queryKey: ['products'],
    queryFn: async (): Promise<Product[]> => {
      const products = await getOperationalProducts();
      const byName = products.filter((p) => p.parent_product_id === null && p.is_active && p.visible_on_pos)
        .sort((a, b) => a.name.localeCompare(b.name));
      return applyComboDisplayOrder(byName)
        .map((p) => ({ ...p,
          dispatch_station: (p.categories?.dispatch_station ?? 'none') as DispatchStation,
          // La disponibilité vient du serveur sans révéler les quantités.
          is_sellable: p.is_sellable, has_variants: p.has_variants,
        } as unknown as Product));
    },
  });
}
