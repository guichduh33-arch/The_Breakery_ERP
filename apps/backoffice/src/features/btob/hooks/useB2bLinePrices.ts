// apps/backoffice/src/features/btob/hooks/useB2bLinePrices.ts
//
// Prix de ligne B2B tels que `create_b2b_order` les fixera. Le formulaire de
// création laissait SAISIR un prix unitaire que la RPC ignore : le total
// affiché pouvait différer de la commande créée (audit Sales 2026-11-21), et le
// préremplissage sautait le prix de catégorie.
//
// Lecture par la famille `get_pos_product_price` : elle appelle le MÊME
// résolveur que la création (`_resolve_b2b_line_price_v1` : négocié >
// catégorie > retail), côté serveur. Rejouer la chaîne ici, maillon par
// maillon, aurait dépendu de la RLS de `customer_product_prices`, gatée sur
// `customers.read` alors que la création ne demande que `b2b.order.create` :
// un compte sans ce droit aurait lu « aucun prix négocié », sans erreur, et vu
// un faux total (revue du lot, 2026-11-22). La RPC, elle, refuse en clair.
// La RPC de création reste l'autorité au moment de l'écriture.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export function useB2bLinePrices(customerId: string, productIds: readonly string[]) {
  const ids = [...new Set(productIds.filter((id) => id !== ''))].sort();
  return useQuery<ReadonlyMap<string, number>>({
    queryKey: ['b2b-line-prices', customerId, ids],
    enabled: customerId !== '' && ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const entries = await Promise.all(ids.map(async (id) => {
        const { data, error } = await supabase.rpc('get_pos_product_price_v1', { p_product_id: id, p_customer_id: customerId });
        if (error) throw error;
        // `Number(null)` vaut 0 : un NULL doit échouer, pas devenir un prix nul.
        const raw: unknown = data;
        const price = raw === null || raw === undefined || raw === '' ? Number.NaN : Number(raw);
        if (!Number.isFinite(price) || price < 0) throw new Error('Invalid product price returned by the server');
        return [id, price] as const;
      }));
      return new Map(entries);
    },
  });
}
