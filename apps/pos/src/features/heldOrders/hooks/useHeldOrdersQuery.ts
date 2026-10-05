import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useShiftStore } from '@/stores/shiftStore';

export interface HeldOrderRow {
  id: string;
  order_number: string;
  table_number: string | null;
  notes: string | null;
  total: number;
  created_at: string;
  status: string;
  sent_to_kitchen_at: string | null;
}

/**
 * Session 35 (F-003) — DB-backed held orders list. Reads every order flagged
 * `is_held = true`, newest first. Replaces the localStorage `heldOrdersStore`
 * read path (the store is retired in the follow-up UI task).
 *
 * BUGFIX (held-order lifecycle gap) — also surfaces FIRED-but-unpaid POS orders
 * (`status = 'pending_payment'`, `created_via = 'pos'`) that were never held
 * (`is_held = false`) — par exemple après réouverture puis abandon du terminal.
 * Ces commandes se reprennent au panier pour paiement ou annulation protégée
 * par PIN manager et déclaration de perte ; aucune suppression directe.
 */
export function useHeldOrdersQuery() {
  const sessionId = useShiftStore((s) => s.current?.id);
  return useQuery({
    queryKey: ['held-orders', sessionId ?? null],
    queryFn: async (): Promise<HeldOrderRow[]> => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, table_number, notes, total, created_at, status, sent_to_kitchen_at')
        .or(`and(status.eq.pending_payment,created_via.eq.pos)${sessionId ? `,and(status.eq.draft,created_via.eq.tablet,session_id.eq.${sessionId})` : ''}`)
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
