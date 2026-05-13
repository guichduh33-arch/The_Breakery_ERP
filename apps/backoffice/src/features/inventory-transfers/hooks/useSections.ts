// apps/backoffice/src/features/inventory-transfers/hooks/useSections.ts
//
// Session 12 — Phase 3 — list active sections (kitchen / bar / pastry / etc.)
// for the transfer From/To selects.

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
