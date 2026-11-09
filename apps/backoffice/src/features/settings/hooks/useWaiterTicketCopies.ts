// apps/backoffice/src/features/settings/hooks/useWaiterTicketCopies.ts
//
// S1-22 — copies du ticket serveur (imprimante 'waiter') à l'envoi en cuisine.
// La colonne business_config.kot_copies_waiter n'est pas exposée par la lecture
// de réglages par catégorie, qui n'a volontairement pas été bumpée : le POS de
// la boutique l'appelle encore. Lecture directe de la colonne (comme le POS),
// écriture par la RPC étroite set_kot_copies_waiter_v1 (même garde et même
// audit que set_setting_v13 pour les copies par poste).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { SETTINGS_QUERY_KEY } from './useSettings.js';

export const WAITER_TICKET_COPIES_KEY = [...SETTINGS_QUERY_KEY, 'kot-copies-waiter'] as const;

export function useWaiterTicketCopies() {
  return useQuery({
    queryKey: WAITER_TICKET_COPIES_KEY,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase
        .from('business_config')
        .select('kot_copies_waiter')
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      // NOT NULL DEFAULT 1 en base, et le POS retombe sur 1 : même miroir ici.
      return data?.kot_copies_waiter ?? 1;
    },
  });
}

export function useSetWaiterTicketCopies() {
  const qc = useQueryClient();
  return useMutation<void, Error, number>({
    mutationFn: async (copies) => {
      const { error } = await supabase.rpc('set_kot_copies_waiter_v1', { p_copies: copies });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: WAITER_TICKET_COPIES_KEY });
    },
  });
}
