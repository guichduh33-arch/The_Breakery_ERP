// apps/pos/src/features/cart/hooks/useStationMap.ts
// S44 P0-B — map product_id → dispatch_station SANS le filtre
// `parent_product_id IS NULL` de useProducts. La grille cache les enfants
// variantes (design S27c), mais le routage cuisine doit les connaître : une
// ligne issue du VariantSelectModal porte le product_id de l'ENFANT, absent du
// cache ['products']. Sans ça, le ticket prep est amputé et `firableCount`
// tombe à 0 sur un panier 100 % variantes (bouton « Send to Kitchen » mort).
import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { DispatchStation } from '@breakery/domain';
import { supabase } from '@/lib/supabase';

export const STATION_MAP_KEY = ['station-map'] as const;

type Row = {
  id: string;
  categories: { dispatch_station: string | null } | Array<{ dispatch_station: string | null }> | null;
};

/** PostgREST renvoie l'embed `categories` en objet OU tableau selon la cardinalité. */
function pickStation(categories: Row['categories']): DispatchStation {
  const rel = Array.isArray(categories) ? categories[0] : categories;
  return (rel?.dispatch_station ?? 'none') as DispatchStation;
}

async function fetchStationMap(): Promise<Record<string, DispatchStation>> {
  const res = await supabase
    .from('products')
    .select('id, categories(dispatch_station)')
    .eq('is_active', true)
    .is('deleted_at', null);
  if (res.error) throw res.error;
  const map: Record<string, DispatchStation> = {};
  for (const row of (res.data ?? []) as Row[]) {
    map[row.id] = pickStation(row.categories);
  }
  return map;
}

export function useStationMap() {
  return useQuery({ queryKey: STATION_MAP_KEY, queryFn: fetchStationMap, staleTime: 60_000 });
}

/** Lecture cache au moment du fire (mutation) — même filet que S43 (cache live, pas closure). */
export async function getStationMap(qc: QueryClient): Promise<Record<string, DispatchStation>> {
  return qc.ensureQueryData({ queryKey: STATION_MAP_KEY, queryFn: fetchStationMap, staleTime: 60_000 });
}
