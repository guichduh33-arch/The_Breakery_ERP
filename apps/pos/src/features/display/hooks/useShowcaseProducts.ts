// apps/pos/src/features/display/hooks/useShowcaseProducts.ts
//
// ADR-023 (déc. 1 et 2) — la vitrine de l'écran client au repos.
//
// La sélection vit sur `business_config` : une liste ORDONNÉE d'ids produit,
// sans aucun prix. Ce hook la résout contre le catalogue au moment de
// l'affichage. Deux propriétés en découlent, exigées comme preuves par
// ADR-023 §2.5 :
//
//   - un produit retiré du catalogue, désactivé ou rendu invisible en caisse
//     DISPARAÎT de la vitrine sans que personne ne rééditionne la sélection ;
//   - un changement de prix au back-office se voit sur l'écran client, parce
//     que le prix n'a jamais été recopié ailleurs.
//
// Lecture directe de la table sous le JWT kiosk (RLS `auth_read` sur products,
// `deleted_at IS NULL`), comme `useDisplayOrders` — l'écran client ne passe pas
// par les RPC de réglages.

import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';

export interface ShowcaseProduct {
  id: string;
  name: string;
  image_url: string | null;
  retail_price: number;
}

export const SHOWCASE_QUERY_KEY = ['display', 'showcase-products'] as const;

/** Le catalogue bouge lentement : un rafraîchissement toutes les 5 min suffit. */
const SHOWCASE_STALE_MS = 5 * 60_000;

/**
 * Charge les produits de la sélection et les rend DANS L'ORDRE de celle-ci —
 * `.in()` ne garantit aucun ordre, et l'ordre est un choix commercial du
 * gérant, pas un détail d'affichage.
 */
export function useShowcaseProducts(productIds: string[], enabled = true) {
  return useQuery<ShowcaseProduct[]>({
    // Les ids font partie de la clé : changer la sélection recharge.
    queryKey: [...SHOWCASE_QUERY_KEY, productIds.join(',')],
    enabled: enabled && productIds.length > 0,
    staleTime: SHOWCASE_STALE_MS,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, image_url, retail_price')
        .in('id', productIds)
        .eq('is_active', true)
        .eq('visible_on_pos', true);
      if (error) throw new Error(error.message);

      const byId = new Map((data ?? []).map((row) => [row.id, row]));
      return productIds
        .map((id) => byId.get(id))
        .filter((row): row is NonNullable<typeof row> => row !== undefined)
        .map((row) => ({
          id: row.id,
          name: row.name,
          image_url: row.image_url,
          retail_price: Number(row.retail_price),
        }));
    },
  });
}
