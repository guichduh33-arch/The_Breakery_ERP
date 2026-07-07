// apps/pos/src/features/tables/hooks/useTableOrders.ts
//
// Fiche 02 D2.5 — carte tableName → commande active pour le mode transfert du
// plan de salle. Même prédicat d'occupation que useTableOccupancy (table posée +
// status hors completed/voided) mais remonte id + order_number. Si plusieurs
// commandes partagent une table (possible aujourd'hui), la PLUS RÉCENTE gagne —
// limite v1 documentée (le transfert multi-commandes par table = session future).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface TableOrderRef {
  id: string;
  order_number: string;
}

interface ActiveOrderRow {
  id: string;
  order_number: string;
  table_number: string;
  created_at: string;
}

export const TABLE_ORDERS_KEY = ['table_orders'];

async function fetchTableOrders(): Promise<Record<string, TableOrderRef>> {
  const { data, error } = await (supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        not: (c: string, op: string, v: unknown) => {
          not: (c: string, op: string, v: unknown) => {
            order: (c: string, o: { ascending: boolean }) => Promise<{
              data: ActiveOrderRow[] | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    };
  })
    .from('orders')
    .select('id, order_number, table_number, created_at')
    .not('table_number', 'is', null)
    .not('status', 'in', '(completed,voided)')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  const map: Record<string, TableOrderRef> = {};
  for (const row of data ?? []) {
    // Trié décroissant → la première occurrence par table est la plus récente.
    if (!(row.table_number in map)) {
      map[row.table_number] = { id: row.id, order_number: row.order_number };
    }
  }
  return map;
}

export function useTableOrders(enabled = true) {
  return useQuery({
    queryKey: TABLE_ORDERS_KEY,
    queryFn: fetchTableOrders,
    staleTime: 15_000,
    enabled,
  });
}
