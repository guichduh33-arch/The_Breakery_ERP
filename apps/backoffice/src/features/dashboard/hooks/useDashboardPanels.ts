// apps/backoffice/src/features/dashboard/hooks/useDashboardPanels.ts
//
// Écran 1c — les trois panneaux qui ne vivent pas dans l'agrégat.
//
// Chacun a sa propre cadence, et c'est le point : les marqueurs « live » de la
// maquette ne sont pas décoratifs. Le plancher et la vitrine bougent à la
// seconde et passent par Supabase Realtime ; la file d'actions bouge à l'heure
// et se contente d'un poll.
//
// Chaque panneau porte aussi son propre droit côté RPC. Un 42501 n'est donc PAS
// une erreur à afficher en rouge : c'est « cette carte ne vous est pas
// destinée ». On le classe pour que la page dégrade carte par carte au lieu de
// tomber en entier.

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export function isRestricted(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  const msg  = e instanceof Error ? e.message : String(e);
  return code === '42501' || /permission denied/i.test(msg);
}

// ── Open orders — état du plancher ─────────────────────────────────────────

export interface OpenOrder {
  id: string;
  order_number: string;
  order_type: string;
  destination: string;
  total: number;
  minutes_open: number;
}

export interface OpenOrdersPanel {
  orders: OpenOrder[];
  open_count: number;
  open_total: number;
  over_45_count: number;
  generated_at: string;
}

export const OPEN_ORDERS_KEY = ['dashboard-open-orders'] as const;

/**
 * Realtime sur `orders`, pas un poll 60 s. Le nom du canal est unique par mount
 * — StrictMode double-monte et des noms partagés collisionnent en silence
 * (même leçon que useKdsRealtime).
 *
 * `refetchInterval` reste posé bas en filet : si le websocket tombe, la carte
 * vieillit d'une minute au pire au lieu de mentir indéfiniment.
 */
export function useOpenOrders(enabled = true) {
  const qc = useQueryClient();

  const query = useQuery<OpenOrdersPanel, Error>({
    queryKey: OPEN_ORDERS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_dashboard_open_orders_v1');
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      return data as unknown as OpenOrdersPanel;
    },
    refetchInterval: 60_000,
    staleTime: 5_000,
    enabled,
    retry: (count, err) => !isRestricted(err) && count < 2,
  });

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel(`dashboard-open-orders-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        void qc.invalidateQueries({ queryKey: OPEN_ORDERS_KEY });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [enabled, qc]);

  return query;
}

// ── Vitrine — compteur + temps depuis la dernière vente ────────────────────

export interface DisplayStockRow {
  product_id: string;
  product_name: string;
  sku: string;
  unit: string;
  quantity: number;
  min_threshold: number | null;
  last_sold_at: string | null;
  minutes_since_sale: number | null;
}

export interface DisplayStockPanel {
  rows: DisplayStockRow[];
  empty_count: number;
  generated_at: string;
}

export const DISPLAY_STOCK_ACTIVITY_KEY = ['dashboard-display-stock'] as const;

export function useDisplayStockActivity(enabled = true) {
  const qc = useQueryClient();

  const query = useQuery<DisplayStockPanel, Error>({
    queryKey: DISPLAY_STOCK_ACTIVITY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_display_stock_activity_v1');
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      return data as unknown as DisplayStockPanel;
    },
    refetchInterval: 60_000,
    staleTime: 5_000,
    enabled,
    retry: (count, err) => !isRestricted(err) && count < 2,
  });

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel(`dashboard-display-stock-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'display_stock' }, () => {
        void qc.invalidateQueries({ queryKey: DISPLAY_STOCK_ACTIVITY_KEY });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [enabled, qc]);

  return query;
}
