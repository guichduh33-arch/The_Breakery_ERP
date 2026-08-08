// apps/backoffice/src/features/btob/hooks/useB2bOrderItems.ts
//
// Les lignes d'une commande B2B, chargées à la demande quand on déplie sa ligne.
//
// `enabled` porte tout le sens du hook : charger les lignes des cinquante
// commandes affichées pour n'en montrer qu'une serait cinquante requêtes pour
// rien. La requête ne part qu'à l'ouverture, et son cache survit à la fermeture
// — rouvrir une ligne déjà consultée est instantané.
//
// L'identifiant est celui de la COMMANDE. Dans view_b2b_invoices, `invoice_id`
// est `orders.id` (la vue le renomme) : une facture B2B n'est pas un objet
// séparé, c'est la commande vue sous son angle comptable.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface B2bOrderItemRow {
  id:            string;
  name_snapshot: string;
  quantity:      number;
  unit_price:    number;
  line_total:    number;
  is_cancelled:  boolean;
}

export const B2B_ORDER_ITEMS_KEY = ['b2b-order-items'] as const;

export function useB2bOrderItems(orderId: string | null) {
  return useQuery<B2bOrderItemRow[]>({
    queryKey: [...B2B_ORDER_ITEMS_KEY, orderId ?? 'none'],
    enabled: orderId !== null,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_items')
        .select('id, name_snapshot, quantity, unit_price, line_total, is_cancelled')
        .eq('order_id', orderId ?? '')
        .order('created_at', { ascending: true });
      if (error !== null) throw new Error(error.message);
      return data ?? [];
    },
  });
}
