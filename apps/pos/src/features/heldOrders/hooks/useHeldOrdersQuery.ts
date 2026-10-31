import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useShiftStore } from '@/stores/shiftStore';
import { useHeldOrdersRealtime } from './useHeldOrdersRealtime';

export interface HeldOrderRow {
  id: string;
  order_number: string;
  table_number: string | null;
  notes: string | null;
  total: number;
  created_at: string;
  status: string;
  created_via?: string;
  sent_to_kitchen_at: string | null;
}

/**
 * Commandes envoyées impayées, de la caisse comme des appareils waiter.
 * Les commandes tablette entrantes sont visibles avant leur prise en charge ;
 * celles déjà reprises restent limitées à la session courante.
 * La reprise conserve le paiement et l'annulation protégée existants.
 */
export function useHeldOrdersQuery() {
  // Le badge reste vivant même lorsque la liste est fermée.
  useHeldOrdersRealtime();
  const sessionId = useShiftStore((s) => s.current?.id);
  return useQuery({
    queryKey: ['held-orders', sessionId ?? null],
    refetchInterval: 30_000,
    queryFn: async (): Promise<HeldOrderRow[]> => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, table_number, notes, total, created_at, status, created_via, sent_to_kitchen_at')
        .or(`and(status.eq.pending_payment,created_via.in.(pos,tablet))${sessionId ? `,and(status.eq.draft,created_via.eq.tablet,session_id.eq.${sessionId})` : ''}`)
        .order('created_at', { ascending: false })
        // Audit 2026-08-24 (perf P1) — sans borne, cette requête rapatriait
        // TOUTES les pending_payment jamais soldées depuis la mise en prod,
        // en continu (elle alimente le badge de la barre d'action). 100 couvre
        // largement les ardoises vivantes d'une journée de service.
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
}
