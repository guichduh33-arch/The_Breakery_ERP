// apps/pos/src/features/kds/__tests__/kdsOfflineStore.test.ts
// Spec 006x lot 3 — tickets KDS locaux (bus LAN) : ingestion idempotente,
// transitions de statut, sélecteurs station + ready display.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  useKdsOfflineStore,
  selectOfflineRowsForStation,
  selectOfflineReadyOrders,
} from '../kdsOfflineStore';
import { tryLocalItemStatus, tryLocalOrderStatus } from '../offlineItemStatus';
import type { OrderFiredPayload } from '@/features/lan/busTopics';

const FIRED: OrderFiredPayload = {
  client_uuid: 'order-uuid-1',
  order_number: 'L-1',
  order_type: 'dine_in',
  table_number: '5',
  notes: null,
  fired_at: '2026-07-20T10:00:00.000Z',
  items: [
    {
      id: 'item-a', product_id: 'p1', product_name: 'Croissant', quantity: 2, unit_price: 15000,
      modifiers: [{ group_name: 'Temp', option_label: 'Warm', price_adjustment: 0 }],
      dispatch_stations: ['kitchen'],
    },
    {
      id: 'item-b', product_id: 'p2', product_name: 'Latte', quantity: 1, unit_price: 30000,
      modifiers: [],
      dispatch_stations: ['barista'],
    },
  ],
};

beforeEach(() => {
  useKdsOfflineStore.getState().clear();
});

describe('kdsOfflineStore', () => {
  it('maps a fired payload to KdsItemRow-compatible pending rows', () => {
    useKdsOfflineStore.getState().addFired(FIRED);
    const row = useKdsOfflineStore.getState().rows['item-a']!;
    expect(row.order_id).toBe('order-uuid-1');
    expect(row.order_number).toBe('L-1');
    expect(row.kitchen_status).toBe('pending');
    expect(row.dispatch_stations).toEqual(['kitchen']);
    expect(row.dispatch_station).toBe('kitchen');
    expect(row.product_name).toBe('Croissant');
    expect(row.kds_station).toBeNull(); // passe tous les chips de filtre
  });

  it('a replayed fired (catchup) never regresses an advanced row', () => {
    useKdsOfflineStore.getState().addFired(FIRED);
    tryLocalItemStatus('item-a', 'ready');
    useKdsOfflineStore.getState().addFired(FIRED); // rejoué
    expect(useKdsOfflineStore.getState().rows['item-a']!.kitchen_status).toBe('ready');
  });

  it('applyStatus stamps prep_started_at / ready_at, ignores unknown items', () => {
    useKdsOfflineStore.getState().addFired(FIRED);
    tryLocalItemStatus('item-a', 'preparing');
    let row = useKdsOfflineStore.getState().rows['item-a']!;
    expect(row.kitchen_status).toBe('preparing');
    expect(row.prep_started_at).not.toBeNull();

    tryLocalItemStatus('item-a', 'ready');
    row = useKdsOfflineStore.getState().rows['item-a']!;
    expect(row.kitchen_status).toBe('ready');
    expect(row.ready_at).not.toBeNull();

    expect(tryLocalItemStatus('ghost', 'ready')).toBe(false); // ligne cloud → RPC
  });

  it('selectOfflineRowsForStation filters by station and drops served rows', () => {
    useKdsOfflineStore.getState().addFired(FIRED);
    expect(selectOfflineRowsForStation(useKdsOfflineStore.getState().rows, 'kitchen')
      .map((r) => r.id)).toEqual(['item-a']);
    expect(selectOfflineRowsForStation(useKdsOfflineStore.getState().rows, 'barista')
      .map((r) => r.id)).toEqual(['item-b']);

    tryLocalItemStatus('item-a', 'served');
    expect(selectOfflineRowsForStation(useKdsOfflineStore.getState().rows, 'kitchen')).toEqual([]);
  });

  it('tryLocalOrderStatus advances every active line of a LOCAL order only', () => {
    useKdsOfflineStore.getState().addFired(FIRED);
    expect(tryLocalOrderStatus('cloud-order-id', 'ready')).toBeNull(); // ordre cloud → RPC
    expect(tryLocalOrderStatus('order-uuid-1', 'ready')).toBe(2);
    const rows = useKdsOfflineStore.getState().rows;
    expect(rows['item-a']!.kitchen_status).toBe('ready');
    expect(rows['item-b']!.kitchen_status).toBe('ready');
  });

  it('selectOfflineReadyOrders aggregates one display row per order, earliest ready first', () => {
    useKdsOfflineStore.getState().addFired(FIRED);
    tryLocalItemStatus('item-b', 'ready');
    const state = useKdsOfflineStore.getState();
    const ready = selectOfflineReadyOrders(state.rows, state.orders);
    expect(ready).toHaveLength(1);
    expect(ready[0]).toMatchObject({
      order_id: 'order-uuid-1',
      order_number: 'L-1',
      order_type: 'dine_in',
      table_number: '5',
    });

    tryLocalItemStatus('item-b', 'served');
    const after = useKdsOfflineStore.getState();
    expect(selectOfflineReadyOrders(after.rows, after.orders)).toEqual([]);
  });
});
