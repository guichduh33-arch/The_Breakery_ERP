// apps/backoffice/src/features/customers/hooks/useCustomerAnalytics.ts
//
// Per-customer purchase analytics — powers the Analytics tab of the customer
// detail page. Reads the customer's recognised sales (RPC family
// `get_customer_recognized_orders`, Outstanding included from its recognition
// date) and their live order lines; the shaping lives in the pure
// `buildCustomerAnalytics` (../customerAnalytics.ts).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import {
  buildCustomerAnalytics,
  type CustomerAnalytics,
  type OrderItemRow,
} from '../customerAnalytics.js';

export type { CustomerAnalytics } from '../customerAnalytics.js';

/**
 * Les lignes se lisent par paquets : un `in.(…)` de plusieurs centaines d'UUID
 * dépassait la longueur d'URL acceptée par la passerelle pour un gros client.
 */
const ITEM_CHUNK = 100;
/**
 * Et chaque paquet se lit par pages : PostgREST plafonne une réponse (1000
 * lignes par défaut), et cent commandes B2B de plus de dix lignes le
 * dépassaient en silence — quantités et parts faussées sans erreur.
 */
const ITEM_PAGE = 1000;

export const customerAnalyticsKey = (customerId: string | null | undefined) =>
  ['customer-analytics', customerId] as const;

export function useCustomerAnalytics(customerId: string | null | undefined) {
  return useQuery<CustomerAnalytics>({
    queryKey: customerAnalyticsKey(customerId),
    enabled: !!customerId,
    staleTime: 60_000,
    queryFn: async (): Promise<CustomerAnalytics> => {
      if (!customerId) return buildCustomerAnalytics([], []);

      const { data: orders, error } = await supabase.rpc('get_customer_recognized_orders_v2', {
        p_customer_id: customerId,
      });
      if (error) throw error;
      const rows = orders ?? [];
      if (rows.length === 0) return buildCustomerAnalytics([], []);

      const ids = rows.map((o) => o.id);
      const items: OrderItemRow[] = [];
      for (let i = 0; i < ids.length; i += ITEM_CHUNK) {
        for (let from = 0; ; from += ITEM_PAGE) {
          const { data, error: itErr } = await supabase
            .from('order_items')
            .select('product_id, name_snapshot, quantity, line_total')
            .in('order_id', ids.slice(i, i + ITEM_CHUNK))
            .eq('is_cancelled', false)
            .order('id', { ascending: true })
            .range(from, from + ITEM_PAGE - 1);
          if (itErr) throw itErr;
          const page = data ?? [];
          items.push(...page);
          if (page.length < ITEM_PAGE) break;
        }
      }

      return buildCustomerAnalytics(rows, items);
    },
  });
}
