// apps/backoffice/src/hooks/useSections.ts
//
// Liste des sections actives. ADR-027 — les sections ne portent plus de stock :
// elles ne sont plus qu'un registre de STATIONS DE PRODUCTION (routage de la
// page Production, affectation produit↔station). Le hook vivait sous la feature
// transferts, supprimée par le même ADR ; il remonte ici, partagé.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface Section {
  id:            string;
  code:          string;
  name:          string;
  kind:          string;
  display_order: number;
}

export const SECTIONS_QUERY_KEY = ['sections'] as const;

export function useSections() {
  return useQuery<Section[]>({
    queryKey: SECTIONS_QUERY_KEY,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sections')
        .select('id, code, name, kind, display_order')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('display_order');

      if (error) throw error;
      return data ?? [];
    },
  });
}
