// apps/pos/src/features/cart/hooks/useStationMap.ts
// S44 P0-B — map product_id → dispatch_station[] SANS le filtre
// `parent_product_id IS NULL` de useProducts. La grille cache les enfants
// variantes (design S27c), mais le routage cuisine doit les connaître : une
// ligne issue du VariantSelectModal porte le product_id de l'ENFANT, absent du
// cache ['products']. Sans ça, le ticket prep est amputé et `firableCount`
// tombe à 0 sur un panier 100 % variantes (bouton « Send to Kitchen » mort).
//
// Spec B-1 Ph2 Task 9 — chaque produit résout vers DispatchStation[] :
//   • override produit (dispatch_stations) s'il est non-vide → tableau verbatim
//   • sinon fallback catégorie (dispatch_station) → [] si 'none'/'absent', [s] sinon
import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { DispatchStation } from '@breakery/domain';
import { supabase } from '@/lib/supabase';

export const STATION_MAP_KEY = ['station-map'] as const;

type Row = {
  id: string;
  dispatch_stations: string[] | null;
  categories: { dispatch_station: string | null } | Array<{ dispatch_station: string | null }> | null;
};

/** Résout le tableau de stations pour un produit.
 * - Override produit (dispatch_stations) prime s'il est non-vide.
 * - Sinon fallback catégorie : 'none' / absent → [].
 * - Dedup via Set au cas où le tableau produit contiendrait des doublons. */
function resolveStations(row: Row): DispatchStation[] {
  if (row.dispatch_stations && row.dispatch_stations.length > 0) {
    return [...new Set(row.dispatch_stations)] as DispatchStation[];
  }
  const rel = Array.isArray(row.categories) ? row.categories[0] : row.categories;
  const single = (rel?.dispatch_station ?? 'none') as DispatchStation;
  return single === 'none' ? [] : [single];
}

async function fetchStationMap(): Promise<Record<string, DispatchStation[]>> {
  const res = await supabase
    .from('products')
    .select('id, dispatch_stations, categories(dispatch_station)')
    .eq('is_active', true)
    .is('deleted_at', null);
  if (res.error) throw res.error;
  const map: Record<string, DispatchStation[]> = {};
  for (const row of (res.data ?? []) as Row[]) {
    map[row.id] = resolveStations(row);
  }
  return map;
}

export function useStationMap() {
  return useQuery({ queryKey: STATION_MAP_KEY, queryFn: fetchStationMap, staleTime: 60_000 });
}

/** Lecture cache au moment du fire (mutation) — même filet que S43 (cache live, pas closure). */
export async function getStationMap(qc: QueryClient): Promise<Record<string, DispatchStation[]>> {
  return qc.ensureQueryData({ queryKey: STATION_MAP_KEY, queryFn: fetchStationMap, staleTime: 60_000 });
}
