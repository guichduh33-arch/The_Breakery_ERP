// apps/backoffice/src/features/settings/hooks/useShowcaseCandidates.ts
//
// ADR-023 déc. 2 — l'univers dans lequel se choisit la vitrine de l'écran
// client.
//
// Il est calé sur ce que l'écran SAIT montrer : actif, visible en caisse, non
// supprimé. C'est délibérément plus étroit que le sélecteur des combos, qui
// liste les 375 produits finis actifs sans regarder `visible_on_pos` — sur ce
// catalogue, 223 d'entre eux n'apparaîtraient jamais en vitrine, et le gérant
// n'aurait aucun moyen de comprendre pourquoi.
//
// Les combos entrent : ce sont des `products` (`product_type = 'combo'`), ils
// se vendent et se voient en caisse. Les parents de variantes sortent : ils ne
// se vendent pas, leur prix n'est pas celui qu'on encaisse.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface ShowcaseCandidate {
  id: string;
  sku: string;
  name: string;
  retail_price: number;
  image_url: string | null;
}

export const SHOWCASE_CANDIDATES_QUERY_KEY = ['settings', 'showcase-candidates'] as const;

export function useShowcaseCandidates() {
  return useQuery<ShowcaseCandidate[]>({
    queryKey: SHOWCASE_CANDIDATES_QUERY_KEY,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, sku, name, retail_price, image_url, parent_product_id')
        .eq('is_active', true)
        .eq('visible_on_pos', true)
        .is('deleted_at', null)
        .order('name');
      if (error) throw error;
      const rows = (data ?? []) as (ShowcaseCandidate & { parent_product_id: string | null })[];
      const parentIds = new Set(
        rows.map((r) => r.parent_product_id).filter((v): v is string => v !== null),
      );
      return rows
        .filter((r) => !parentIds.has(r.id))
        .map(({ id, sku, name, retail_price, image_url }) => ({
          id,
          sku,
          name,
          retail_price: Number(retail_price),
          image_url,
        }));
    },
  });
}
