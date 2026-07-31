// apps/pos/src/features/inbox/hooks/useCloseCancelledTabletOrder.ts
//
// ADR-010 — la sortie d'une commande tablette vidée.
//
// Une commande tablette naît avec toutes ses lignes `is_locked` et déjà parties
// en cuisine. La seule façon d'en retirer une ligne est le flux cancel-item
// (PIN manager + déclaration de perte). Une fois la dernière ligne annulée, la
// commande reste en `pending_payment` avec un total à 0 — donc affichée
// indéfiniment dans cette inbox, qui filtre sur ce statut.
//
// `close_cancelled_tablet_order_v1` ne fait que CONSTATER : elle refuse (P0014)
// tant qu'une ligne est active, ce qui l'empêche de servir de contournement au
// flux cancel-item. Elle remplace `cancel_tablet_order`, supprimée.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

export function useCloseCancelledTabletOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase.rpc('close_cancelled_tablet_order_v1', {
        p_order_id: orderId,
      });
      if (error) throw Object.assign(new Error(error.message), { details: error });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pending-tablet-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['table_occupancy'] });
      toast.success('Order closed');
    },
    onError: (err: Error & { details?: { code?: string } }) => {
      // P0014 = des lignes vivent encore. Le caissier doit passer par le flux
      // cancel-item (manager + perte), pas forcer la clôture.
      toast.error(
        err.details?.code === 'P0014'
          ? 'Cancel the remaining lines first (manager + waste)'
          : (err.message ?? 'Close failed'),
      );
    },
  });
}
