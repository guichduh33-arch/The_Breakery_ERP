import type { KdsItemRow } from './hooks/useKdsOrders';
import { kitchenRank } from './offlineKitchenJournal';

export interface KitchenResolution {
  order_id: string;
  order_number: string;
  order_status: string;
  items: { id: string; client_line_id: string | null; kitchen_status: string; is_cancelled: boolean }[];
}

/** Fusion par identité attestée par la RPC ; jamais par produit ou numéro visible. */
export function mergeKitchenRows(
  cloud: KdsItemRow[], local: Record<string, KdsItemRow>,
  resolutions: Record<string, KitchenResolution>, station: string,
): KdsItemRow[] {
  const result = new Map(cloud.map((row) => [row.id, row]));
  for (const row of Object.values(local)) {
    const stations = row.dispatch_stations ?? [row.dispatch_station];
    if (!stations.includes(station)) continue;
    const resolution = resolutions[row.order_id];
    const canonical = resolution?.items.find((item) => item.client_line_id === row.id);
    const serverRow = canonical ? result.get(canonical.id) : undefined;
    const cancelled = canonical?.is_cancelled === true || serverRow?.is_cancelled === true ||
      ['voided', 'cancelled', 'refunded'].includes(resolution?.order_status ?? '') ||
      ['voided', 'cancelled', 'refunded'].includes(serverRow?.order_status ?? '');
    if (cancelled || canonical?.kitchen_status === 'served' || serverRow?.kitchen_status === 'served') {
      if (canonical) result.delete(canonical.id);
      continue;
    }
    // Une carte cloud plus ancienne que le fait local n'est jamais réaffichée.
    if (canonical && serverRow && kitchenRank[serverRow.kitchen_status]! >= kitchenRank[row.kitchen_status]!) continue;
    if (canonical) result.delete(canonical.id);
    if (row.kitchen_status === 'served') continue;
    result.set(row.id, row);
  }
  // Regroupement canonique commun, identités de mutation inchangées.
  return [...result.values()].map((row) => {
    const resolution = resolutions[row.order_id];
    return { ...row, group_order_id: resolution?.order_id ?? row.order_id };
  });
}
