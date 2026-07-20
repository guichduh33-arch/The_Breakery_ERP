// apps/pos/src/features/kds/offlineItemStatus.ts
// Spec 006x lot 3 — avancement de statut d'une ligne LOCALE (fired via le
// bus, inexistante en DB). Les mutations KDS (bump/start-prep/serve)
// détectent une ligne locale et passent par ici AU LIEU de la RPC — quel
// que soit le mode : une ligne locale n'a pas d'id DB, la RPC échouerait
// toujours dessus.
//
// L'état local est appliqué D'ABORD (la cuisine continue même hub down),
// puis publié sur le bus best-effort pour les autres surfaces (caisse,
// display). Le replay cloud de ces statuts est le travail du lot 4.

import { hubBus } from '@/features/lan/hubBusClient';
import type { BusKitchenStatus, OrderItemStatusPayload } from '@/features/lan/busTopics';
import { useKdsOfflineStore } from './kdsOfflineStore';

/**
 * Applique + publie un statut si `itemId` est une ligne locale.
 * Retourne false si la ligne est inconnue du store local (ligne cloud →
 * l'appelant suit le chemin RPC normal).
 */
export function tryLocalItemStatus(itemId: string, status: BusKitchenStatus): boolean {
  const state = useKdsOfflineStore.getState();
  const row = state.rows[itemId];
  if (row === undefined) return false;

  const meta = state.orders[row.order_id];
  const payload: OrderItemStatusPayload = {
    item_id: itemId,
    order_id: row.order_id,
    kitchen_status: status,
    at: new Date().toISOString(),
    order_number: meta?.order_number ?? row.order_number,
    order_type: meta?.order_type ?? '',
    table_number: meta?.table_number ?? null,
  };
  state.applyStatus(payload);
  hubBus.publish('order.item_status', payload);
  return true;
}

/**
 * Variante ordre entier : toutes les lignes actives d'un order id LOCAL.
 * Retourne le nombre de lignes avancées, ou null si l'ordre n'est pas local.
 */
export function tryLocalOrderStatus(orderId: string, status: BusKitchenStatus): number | null {
  const state = useKdsOfflineStore.getState();
  const items = Object.values(state.rows).filter(
    (r) => r.order_id === orderId && r.kitchen_status !== 'served',
  );
  if (state.orders[orderId] === undefined) return null;
  for (const item of items) tryLocalItemStatus(item.id, status);
  return items.length;
}
