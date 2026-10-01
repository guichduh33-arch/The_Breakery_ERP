import type { OrderFiredPayload, OrderItemStatusPayload, BusKitchenStatus } from '@/features/lan/busTopics';
import { parseOrderFired, parseOrderItemStatus } from '@/features/lan/busTopics';

export interface KitchenIntent {
  id: string;
  actorId: string;
  rootId: string;
  itemId: string;
  status: BusKitchenStatus;
  at: string;
}
export interface KitchenJournal {
  version: 1;
  fired: Record<string, OrderFiredPayload>;
  statuses: Record<string, OrderItemStatusPayload>;
  intents: KitchenIntent[];
  retired?: Record<string, string[]>;
}
const KEY = 'breakery.kitchen-journal.v1';
const empty = (): KitchenJournal => ({ version: 1, fired: {}, statuses: {}, intents: [] });
export const kitchenRank: Record<string, number> = { pending: 0, preparing: 1, ready: 2, served: 3 };

/** Lecture stricte : une sauvegarde illisible n'est jamais remplacée par du vide. */
export function readKitchenJournal(): KitchenJournal {
  const raw = localStorage.getItem(KEY);
  if (raw === null) return empty();
  const value = JSON.parse(raw) as KitchenJournal;
  if (value?.version !== 1 || !value.fired || !value.statuses || !Array.isArray(value.intents) ||
      Object.values(value.fired).some((item) => parseOrderFired(item) === null) ||
      Object.values(value.statuses).some((item) => parseOrderItemStatus(item) === null) ||
      value.intents.some((item) => !item || typeof item.id !== 'string' || !item.id ||
        typeof item.actorId !== 'string' || !item.actorId || typeof item.rootId !== 'string' ||
        typeof item.itemId !== 'string' || !['preparing', 'ready', 'served'].includes(item.status) ||
        typeof item.at !== 'string' || !Number.isFinite(Date.parse(item.at)))) {
    throw new Error('Saved kitchen operations could not be read. Keep this browser data.');
  }
  return value;
}

/** Un setItem atomique porte projection ET intention ; une erreur ne confirme rien. */
export function updateKitchenJournal(update: (state: KitchenJournal) => KitchenJournal): void {
  localStorage.setItem(KEY, JSON.stringify(update(readKitchenJournal())));
}

export function saveKitchenFired(payload: OrderFiredPayload): OrderFiredPayload {
  let filtered = payload;
  updateKitchenJournal((state) => {
    const retired = state.retired?.[payload.client_uuid] ?? [];
    filtered = { ...payload, items: payload.items.filter((item) => !retired.includes(item.id)) };
    const items = new Map(state.fired[payload.client_uuid]?.items.map((item) => [item.id, item]) ?? []);
    for (const item of filtered.items) if (!items.has(item.id)) items.set(item.id, item);
    if (items.size === 0) return state;
    return { ...state, fired: { ...state.fired, [payload.client_uuid]: { ...payload, items: [...items.values()] } } };
  });
  return filtered;
}

/** Retrait de projection après preuve canonique, jamais purge d'intentions. */
export function retireKitchenRoot(root: string, verifiedIds: readonly string[]): boolean {
  let retired = false;
  updateKitchenJournal((state) => {
    if (state.intents.some((intent) => intent.rootId === root)) return state;
    const fired = { ...state.fired };
    const ids = fired[root]?.items.filter((item) => verifiedIds.includes(item.id)).map((item) => item.id) ?? [];
    const remaining = fired[root]?.items.filter((item) => !ids.includes(item.id)) ?? [];
    if (remaining.length > 0) fired[root] = { ...fired[root]!, items: remaining };
    else delete fired[root];
    const statuses = Object.fromEntries(Object.entries(state.statuses).filter(([, status]) =>
      status.order_id !== root || !ids.includes(status.item_id)));
    retired = true;
    return { ...state, fired, statuses, retired: { ...state.retired, [root]: [...new Set([...(state.retired?.[root] ?? []), ...ids])] } };
  });
  return retired;
}

export function saveKitchenStatus(payload: OrderItemStatusPayload, actorId?: string): void {
  updateKitchenJournal((state) => {
    const previous = state.statuses[payload.item_id];
    if (previous && previous.order_id !== payload.order_id) throw new Error('Conflicting kitchen line identities');
    const roots = Object.values(state.fired).filter((fired) => fired.items.some((item) => item.id === payload.item_id));
    if (roots.some((fired) => fired.client_uuid !== payload.order_id)) throw new Error('Conflicting kitchen line identities');
    if (previous && kitchenRank[previous.kitchen_status]! >= kitchenRank[payload.kitchen_status]!) return state;
    return {
      ...state,
      statuses: { ...state.statuses, [payload.item_id]: payload },
      intents: actorId ? [...state.intents, {
        id: crypto.randomUUID(), actorId, rootId: payload.order_id, itemId: payload.item_id,
        status: payload.kitchen_status, at: payload.at,
      }] : state.intents,
    };
  });
}

export function acknowledgeKitchenIntent(id: string): void {
  updateKitchenJournal((state) => ({ ...state, intents: state.intents.filter((intent) => intent.id !== id) }));
}
