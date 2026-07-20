// apps/pos/src/features/kds/kdsOfflineStore.ts
// Spec 006x lot 3 — tickets KDS reçus par le BUS LAN en mode OFFLINE.
// Source locale et volatile (en mémoire) : les commandes fired hors-ligne
// n'existent nulle part en DB tant que le replay (lot 4) n'a pas rejoué le
// fire — ce store est la SEULE vue cuisine de ces commandes. Les lignes
// restent après le retour online jusqu'à être servies (la query cloud ne
// les connaît pas) ; le dedup est porté par le bus client (msg_id).

import { create } from 'zustand';
import type { KdsItemRow } from './hooks/useKdsOrders';
import type { OrderFiredPayload, OrderItemStatusPayload } from '@/features/lan/busTopics';

/** Méta d'ordre local — nécessaire aux payloads order.item_status (le
 *  customer display rend order_type/table sans avoir vu le fired). */
export interface OfflineOrderMeta {
  order_number: string;
  order_type: string;
  table_number: string | null;
}

interface KdsOfflineState {
  /** Lignes locales par item id (uuid client du fire). */
  rows: Record<string, KdsItemRow>;
  /** Méta par order id local (client_uuid du fire). */
  orders: Record<string, OfflineOrderMeta>;
  addFired: (payload: OrderFiredPayload) => void;
  applyStatus: (payload: OrderItemStatusPayload) => void;
  clear: () => void;
}

function toKdsRow(payload: OrderFiredPayload, item: OrderFiredPayload['items'][number]): KdsItemRow {
  return {
    id: item.id,
    order_id: payload.client_uuid,
    product_id: item.product_id,
    product_name: item.product_name,
    quantity: item.quantity,
    unit_price: item.unit_price,
    modifiers: item.modifiers,
    modifiers_total: item.modifiers.reduce((sum, m) => sum + m.price_adjustment, 0),
    kitchen_status: 'pending',
    // Colonne legacy — la 1ʳᵉ station résolue (le filtre board passe par
    // dispatch_stations en priorité, même dual-branch que la query SQL).
    dispatch_station: (item.dispatch_stations[0] ?? 'none') as KdsItemRow['dispatch_station'],
    dispatch_stations: item.dispatch_stations,
    sent_to_kitchen_at: payload.fired_at,
    ready_at: null,
    prep_started_at: null,
    order_number: payload.order_number,
    // Pas de statut de paiement offline (badge PAID jamais affiché).
    order_status: '',
    order_notes: payload.notes,
    is_cancelled: false,
    cancelled_at: null,
    cancelled_reason: null,
    // Chip filter : NULL passe tous les chips (catégorie inconnue offline).
    kds_station: null,
  };
}

export const useKdsOfflineStore = create<KdsOfflineState>((set) => ({
  rows: {},
  orders: {},

  addFired: (payload) =>
    set((state) => {
      const rows = { ...state.rows };
      for (const item of payload.items) {
        // Idempotent : un fired rejoué (catchup) n'écrase pas une ligne dont
        // le statut a déjà avancé localement.
        rows[item.id] ??= toKdsRow(payload, item);
      }
      const orders = {
        ...state.orders,
        [payload.client_uuid]: {
          order_number: payload.order_number,
          order_type: payload.order_type,
          table_number: payload.table_number,
        },
      };
      return { rows, orders };
    }),

  applyStatus: (payload) =>
    set((state) => {
      const existing = state.rows[payload.item_id];
      if (existing === undefined) return state;
      const next: KdsItemRow = {
        ...existing,
        kitchen_status: payload.kitchen_status,
        ...(payload.kitchen_status === 'preparing' && existing.prep_started_at === null
          ? { prep_started_at: payload.at }
          : {}),
        ...(payload.kitchen_status === 'ready' ? { ready_at: payload.at } : {}),
      };
      return { rows: { ...state.rows, [payload.item_id]: next } };
    }),

  clear: () => set({ rows: {} }),
}));

/** File « ready for pickup » locale pour le customer display (spec §1 —
 *  alimentée par le hub) : une entrée par ordre ayant ≥ 1 ligne ready,
 *  earliest ready_at, même contrat que useReadyOrders. */
export interface OfflineReadyOrder {
  order_id: string;
  order_number: string;
  order_type: string;
  table_number: string | null;
  ready_at: string | null;
}

export function selectOfflineReadyOrders(
  rows: Record<string, KdsItemRow>,
  orders: Record<string, OfflineOrderMeta>,
): OfflineReadyOrder[] {
  const byOrder = new Map<string, OfflineReadyOrder>();
  const readyRows = Object.values(rows)
    .filter((r) => r.kitchen_status === 'ready')
    .sort((a, b) => (a.ready_at ?? '').localeCompare(b.ready_at ?? ''));
  for (const row of readyRows) {
    if (byOrder.has(row.order_id)) continue; // earliest wins (tri ascendant).
    const meta = orders[row.order_id];
    byOrder.set(row.order_id, {
      order_id: row.order_id,
      order_number: meta?.order_number ?? row.order_number,
      order_type: meta?.order_type ?? '',
      table_number: meta?.table_number ?? null,
      ready_at: row.ready_at,
    });
  }
  return Array.from(byOrder.values());
}

/** Lignes actives (non servies) pour une station donnée — même filtre
 *  dual-branch que la query SQL de useKdsOrders, tri FIFO. */
export function selectOfflineRowsForStation(
  rows: Record<string, KdsItemRow>,
  station: string,
): KdsItemRow[] {
  return Object.values(rows)
    .filter((r) => r.kitchen_status !== 'served')
    .filter((r) =>
      r.dispatch_stations !== null && r.dispatch_stations.length > 0
        ? r.dispatch_stations.includes(station)
        : r.dispatch_station === station,
    )
    .sort((a, b) => a.sent_to_kitchen_at.localeCompare(b.sent_to_kitchen_at));
}
