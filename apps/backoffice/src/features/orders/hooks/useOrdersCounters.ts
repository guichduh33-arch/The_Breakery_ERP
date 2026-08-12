// apps/backoffice/src/features/orders/hooks/useOrdersCounters.ts
//
// Agrégats de la liste des commandes (`get_orders_counters_v1`). ADR-025.
//
// Même séparation que la liste de stock (ADR-024) : les compteurs existent
// même quand la liste ne ramène aucune ligne, et ils ne dépendent pas du
// curseur de pagination. La clé de requête ne porte volontairement PAS le
// statut actif — les compteurs mesurent la fenêtre et les filtres, jamais le
// panier sélectionné (ADR-025 déc. 2) : la fonction serveur l'ignore de toute
// façon, et le garder hors de la clé évite un refetch par clic d'onglet.
//
// Clé imbriquée sous ['orders', 'list'] : l'invalidation realtime de
// `useOrdersRealtime` rafraîchit lignes ET compteurs d'un seul geste.

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import type { Database } from '@breakery/supabase';
import { supabase } from '@/lib/supabase.js';
import type { OrdersListFilters } from './useOrdersList.js';

export type OrderStatus = Database['public']['Enums']['order_status'];

export interface OrdersCounterCell {
  count:  number;
  amount: number;
}

export interface OrdersCounters {
  total:  OrdersCounterCell;
  /** Au moins un paiement enregistré (ADR-025 déc. 5). */
  paid:   OrdersCounterCell;
  /** Aucun paiement et non annulée (ADR-025 déc. 5). */
  unpaid: OrdersCounterCell;
  /** Un statut absent de la fenêtre est absent de l'objet — lire via 0. */
  by_status: Partial<Record<OrderStatus, OrdersCounterCell>>;
}

export interface UseOrdersCountersParams {
  start:    string;
  end:      string;
  /** Les filtres serveur SANS le statut — il n'appartient pas aux compteurs. */
  filters?: Omit<OrdersListFilters, 'status'>;
}

const ZERO: OrdersCounterCell = { count: 0, amount: 0 };

export const ORDERS_COUNTERS_QUERY_KEY = ['orders', 'list', 'counters'] as const;

function toJsonbFilters(filters?: Omit<OrdersListFilters, 'status'>): Record<string, string | number> {
  if (!filters) return {};
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = v;
  }
  return out;
}

export function useOrdersCounters(params: UseOrdersCountersParams) {
  return useQuery<OrdersCounters>({
    queryKey: [...ORDERS_COUNTERS_QUERY_KEY, params] as const,
    staleTime: 30_000,
    // Les compteurs restent affichés pendant un changement de filtre : les
    // laisser retomber à zéro entre deux réponses ferait clignoter la bande.
    placeholderData: keepPreviousData,
    enabled: Boolean(params.start && params.end),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_orders_counters_v1', {
        p_start:   params.start,
        p_end:     params.end,
        p_filters: toJsonbFilters(params.filters),
      });
      if (error) throw error;
      const raw = data as unknown as Partial<OrdersCounters> | null;
      return {
        total:     raw?.total     ?? ZERO,
        paid:      raw?.paid      ?? ZERO,
        unpaid:    raw?.unpaid    ?? ZERO,
        by_status: raw?.by_status ?? {},
      };
    },
  });
}
