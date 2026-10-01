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
import { useAuthStore } from '@/stores/authStore';
import { saveKitchenStatus } from './offlineKitchenJournal';

/**
 * Applique + publie un statut si `itemId` est une ligne locale.
 * Retourne false si la ligne est inconnue du store local (ligne cloud →
 * l'appelant suit le chemin RPC normal).
 */
export function tryLocalItemStatus(itemId: string, status: BusKitchenStatus): boolean {
  const state = useKdsOfflineStore.getState();
  const row = localKitchenRow(itemId);
  if (row === undefined) return false;
  const auth = useAuthStore.getState();
  if (!auth.isAuthenticated || auth.isLocked || !auth.user ||
      !(auth.user.role_code === 'SUPER_ADMIN' || auth.permissions.includes('kds.operate'))) {
    throw new Error('Sign in with kitchen access to save this operation.');
  }

  const meta = state.orders[row.order_id];
  const payload: OrderItemStatusPayload = {
    item_id: row.id,
    order_id: row.order_id,
    kitchen_status: status,
    at: new Date().toISOString(),
    order_number: meta?.order_number ?? row.order_number,
    order_type: meta?.order_type ?? '',
    table_number: meta?.table_number ?? null,
  };
  saveKitchenStatus(payload, auth.user.id);
  state.applyStatus(payload);
  // L'échec du bus ne doit pas inviter à refaire un geste déjà durable.
  try { hubBus.publish('order.item_status', payload); } catch { /* rejeu durable au retour cloud */ }
  return true;
}

/** Un alias serveur n'existe que pour une ligne de la racine attestée. */
export function localKitchenRow(itemId: string) {
  const state = useKdsOfflineStore.getState();
  if (state.rows[itemId]) return state.rows[itemId];
  for (const [root, resolution] of Object.entries(state.resolutions)) {
    const canonical = resolution.items.find((item) => item.id === itemId);
    const row = canonical?.client_line_id ? state.rows[canonical.client_line_id] : undefined;
    if (row?.order_id === root) return row;
  }
  return undefined;
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
