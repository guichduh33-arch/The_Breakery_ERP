// apps/backoffice/src/features/orders/hooks/useOrdersCounters.ts
//
// Agrégats de la liste des commandes (`get_orders_counters_v2`). ADR-025,
// amendée après review PR #367 :
//   · RÉGLÉ = paiement enregistré OU statut paid/completed — les règlements
//     B2B n'écrivent jamais dans order_payments ;
//   · les commandes annulées sortent des paniers paid/unpaid ;
//   · une cellule `refunded` porte le total remboursé de la fenêtre.
//
// Le parse est STRICT : une forme inattendue jette au lieu de retomber sur
// des zéros — un zéro par défaut est indistinguable d'un vrai zéro, et c'est
// précisément « le chiffre faux affiché comme vrai » que l'ADR-025 tue. La
// page lit `isError` et rend des tirets, jamais des zéros inventés.
//
// La clé de requête ne porte PAS le statut actif (D2) et vit sous le préfixe
// ['orders','list'] : l'invalidation realtime et les mutations rafraîchissent
// lignes ET compteurs d'un seul geste.

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { toJsonbFilters, type OrdersListFilters } from './useOrdersList.js';
import type { OrderStatus } from '../statusMeta.js';

export interface OrdersCounterCell {
  count:  number;
  amount: number;
}

export interface OrdersCounters {
  total:    OrdersCounterCell;
  /** Réglé : paiement enregistré OU statut paid/completed, hors voided. */
  paid:     OrdersCounterCell;
  /** Ni réglé ni annulé. */
  unpaid:   OrdersCounterCell;
  /** Commandes remboursées de la fenêtre ; amount = total remboursé. */
  refunded: OrdersCounterCell;
  /** Un statut absent de la fenêtre est absent de l'objet — lire via 0. */
  by_status: Partial<Record<OrderStatus, OrdersCounterCell>>;
}

export interface UseOrdersCountersParams {
  start:    string;
  end:      string;
  /** Les filtres serveur SANS le statut — il n'appartient pas aux compteurs. */
  filters?: Omit<OrdersListFilters, 'status'>;
}

export const ORDERS_COUNTERS_QUERY_KEY = ['orders', 'list', 'counters'] as const;

function parseCell(raw: unknown, key: string): OrdersCounterCell {
  const cell = raw as { count?: unknown; amount?: unknown } | null | undefined;
  if (cell == null || typeof cell.count !== 'number' || typeof cell.amount !== 'number') {
    throw new Error(`get_orders_counters_v2: unexpected shape for "${key}"`);
  }
  return { count: cell.count, amount: cell.amount };
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
      const { data, error } = await supabase.rpc('get_orders_counters_v2', {
        p_start:   params.start,
        p_end:     params.end,
        p_filters: toJsonbFilters(params.filters),
      });
      if (error) throw error;
      const raw = data as unknown as {
        total?: unknown; paid?: unknown; unpaid?: unknown; refunded?: unknown;
        by_status?: Partial<Record<OrderStatus, OrdersCounterCell>>;
      } | null;
      return {
        total:     parseCell(raw?.total, 'total'),
        paid:      parseCell(raw?.paid, 'paid'),
        unpaid:    parseCell(raw?.unpaid, 'unpaid'),
        refunded:  parseCell(raw?.refunded, 'refunded'),
        by_status: raw?.by_status ?? {},
      };
    },
  });
}
