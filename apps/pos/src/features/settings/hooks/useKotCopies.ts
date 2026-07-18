// apps/pos/src/features/settings/hooks/useKotCopies.ts
//
// Chantier KOT copies (migration 20260718000195) — copies du ticket cuisine
// papier par station prep au moment du fire, org-wide sur business_config
// (catégorie symbolique 'printing'). 0 = pas de papier pour la station (le
// KDS écran reçoit toujours — l'envoi DB ne change pas). Défaut 1 copie
// (= comportement historique) pendant le chargement / en erreur — une lecture
// de config ne bloque jamais un envoi cuisine (pattern useTaxConfig).
// La query key vit sous le préfixe ['business-config'] : useSettingsRealtime
// pousse les changements BO au terminal sans attendre le staleTime.
import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { PrepStation } from '@breakery/domain';
import { supabase } from '@/lib/supabase';

export const KOT_COPIES_KEY = ['business-config', 'kot-copies'] as const;

export type KotCopies = Record<PrepStation, number>;

export const KOT_COPIES_DEFAULTS: KotCopies = { barista: 1, kitchen: 1, display: 1 };

async function fetchKotCopies(): Promise<KotCopies> {
  const { data, error } = await supabase
    .from('business_config')
    .select('kot_copies_barista, kot_copies_kitchen, kot_copies_display')
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    barista: data?.kot_copies_barista ?? 1,
    kitchen: data?.kot_copies_kitchen ?? 1,
    display: data?.kot_copies_display ?? 1,
  };
}

export function useKotCopies() {
  return useQuery({
    queryKey: KOT_COPIES_KEY,
    queryFn: fetchKotCopies,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

/** Lecture cache au moment du fire (mutation) — cache live, pas closure de
 *  render ; retombe sur 1 copie par station si la config est injoignable. */
export async function getKotCopies(qc: QueryClient): Promise<KotCopies> {
  try {
    return await qc.ensureQueryData({
      queryKey: KOT_COPIES_KEY,
      queryFn: fetchKotCopies,
      staleTime: 5 * 60_000,
      retry: 1,
    });
  } catch {
    return KOT_COPIES_DEFAULTS;
  }
}
