// apps/backoffice/src/features/pos-terminals/hooks/usePosTerminals.ts
// Registre des terminaux POS (`pos_devices`) : chaque appareil s'y inscrit seul
// au premier lot d'événements du journal, sous le libellé « Unregistered … ».
// Un responsable le nomme ensuite depuis cet écran (`register_pos_device_v1`).
// Lecture gardée par `reports.audit.read` (RLS de `pos_devices` et `pos_events`).
//
// Pour reconnaître un appareil, l'écran affiche qui l'a utilisé en dernier :
// une lecture `limit 1` par terminal, servie par l'index (device_id, device_seq),
// ~5 ms en prod. Ce repère est un confort : son échec ne masque pas la liste.
// Deux variantes écartées le 2026-11-28 :
//  - vingt lectures parallèles saturaient le pool de connexions de la base dev
//    (500 après ~12 s) → lots de HINT_BATCH lectures ;
//  - une lecture globale plafonnée laissait sans repère un terminal calme quand
//    la caisse remplissait seule le plafond.
// Le repère se limite aux HINT_LIMIT terminaux vus en dernier : chaque navigateur
// vidé ou base de test crée un nouveau jeton (228 lignes sur dev ce jour-là).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

/** Miroir de la contrainte CHECK `pos_devices.kind` (colonne text, pas un enum). */
export type PosTerminalKind = 'counter' | 'tablet' | 'kds' | 'kiosk' | 'unknown';

export interface PosTerminalRow {
  id: string;
  device_token: string;
  label: string;
  kind: PosTerminalKind;
  is_registered: boolean;
  registered_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  is_active: boolean;
  /** Nom du dernier utilisateur vu sur l'appareil ; null si inconnu. */
  last_user: string | null;
}

export const POS_TERMINALS_KEY = ['pos-terminals'] as const;

/** Nombre de terminaux (les plus récents) pour lesquels on cherche le dernier utilisateur. */
export const HINT_LIMIT = 20;
/** Lectures `pos_events` lancées en même temps. */
export const HINT_BATCH = 4;

const DEVICE_COLS =
  'id, device_token, label, kind, is_registered, registered_at, first_seen_at, last_seen_at, is_active';

async function lastActorOf(deviceId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('pos_events')
    .select('actor_id')
    .eq('device_id', deviceId)
    .not('device_seq', 'is', null)
    .order('device_seq', { ascending: false })
    .limit(1);
  if (error !== null) return null;
  return data?.[0]?.actor_id ?? null;
}

/** Dernier acteur par terminal, par lots de HINT_BATCH lectures. */
async function lastActorsOf(deviceIds: string[]): Promise<Map<string, string>> {
  const latest = new Map<string, string>();
  for (let i = 0; i < deviceIds.length; i += HINT_BATCH) {
    const batch = deviceIds.slice(i, i + HINT_BATCH);
    const actors = await Promise.all(batch.map(lastActorOf));
    batch.forEach((id, j) => {
      const actor = actors[j];
      if (actor !== null && actor !== undefined) latest.set(id, actor);
    });
  }
  return latest;
}

export function usePosTerminals() {
  return useQuery<PosTerminalRow[]>({
    queryKey: POS_TERMINALS_KEY,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pos_devices')
        .select(DEVICE_COLS)
        .order('last_seen_at', { ascending: false });
      if (error !== null) throw new Error(error.message);
      const devices = data ?? [];

      // `devices` est trié par last_seen_at décroissant : les premiers sont les actifs.
      const actors = await lastActorsOf(devices.slice(0, HINT_LIMIT).map((d) => d.id));
      const uniqueIds = [...new Set(actors.values())];
      const names = new Map<string, string>();
      if (uniqueIds.length > 0) {
        // `user_profiles` est lisible par tout compte connecté (policy auth_read).
        const profiles = await supabase.from('user_profiles').select('id, full_name').in('id', uniqueIds);
        for (const p of profiles.data ?? []) {
          if (p.full_name !== null) names.set(p.id, p.full_name);
        }
      }

      return devices.map((d) => {
        const actor = actors.get(d.id);
        return {
          ...d,
          kind: d.kind as PosTerminalKind,
          last_user: actor !== undefined ? (names.get(actor) ?? null) : null,
        };
      });
    },
  });
}
