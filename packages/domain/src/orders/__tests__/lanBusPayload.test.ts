import { describe, expect, it } from 'vitest';
import { parseOrderFired, parseOrderItemStatus } from '../../lanBusPayload.js';

const modifier = { group_name: 'Milk', option_label: 'Oat', price_adjustment: 1000 };
const item = {
  id: 'line-1', product_id: 'product-1', product_name: 'Coffee', quantity: 2,
  unit_price: 25000, modifiers: [modifier], dispatch_stations: ['barista'],
};
const fired = {
  client_uuid: 'order-1', order_number: 'L-1', order_type: 'take_out',
  table_number: null, notes: null, fired_at: '2026-09-27T10:00:00Z', items: [item],
};
const status = {
  item_id: 'line-1', order_id: 'order-1', kitchen_status: 'ready',
  at: '2026-09-27T10:01:00Z', order_number: 'L-1', order_type: 'take_out', table_number: null,
};

describe('LAN payload boundary', () => {
  it('preserves the offline order identity, modifiers and station routing', () => {
    expect(parseOrderFired(fired)).toEqual(fired);
    const combo = { ...fired, table_number: '4', notes: 'No sugar', items: [{
      ...item, component_modifiers: [{ ...modifier, component_name: 'Coffee' }],
    }] };
    expect(parseOrderFired(combo)).toEqual(combo);
  });

  it.each([null, undefined, 42, 'order'])('refuses non-object input %s', value => {
    expect(parseOrderFired(value)).toBeNull();
    expect(parseOrderItemStatus(value)).toBeNull();
  });

  it.each([
    ['client_uuid', ''], ['client_uuid', 1], ['order_number', ''], ['order_number', 1],
    ['order_type', null], ['table_number', 4], ['notes', false],
    ['fired_at', 1], ['fired_at', 'yesterday'], ['items', null], ['items', []],
  ])('refuses invalid order field %s', (field, value) => {
    expect(parseOrderFired({ ...fired, [field]: value })).toBeNull();
  });

  it.each([
    ['id', ''], ['id', 1], ['product_id', null], ['product_name', null],
    ['quantity', 0], ['quantity', -1], ['quantity', Infinity], ['quantity', '2'],
    ['unit_price', NaN], ['unit_price', -1], ['unit_price', '25000'],
    ['modifiers', null], ['modifiers', [null]], ['modifiers', [{ ...modifier, group_name: 1 }]],
    ['modifiers', [{ ...modifier, option_label: 1 }]],
    ['modifiers', [{ ...modifier, price_adjustment: '1000' }]],
    ['modifiers', [{ ...modifier, price_adjustment: Infinity }]],
    ['component_modifiers', null], ['component_modifiers', [{ ...modifier, component_name: 1 }]],
    ['component_modifiers', [{ component_name: 'Coffee' }]],
    ['dispatch_stations', null], ['dispatch_stations', [1]],
  ])('refuses invalid line field %s without a partial order', (field, value) => {
    expect(parseOrderFired({ ...fired, items: [{ ...item, [field]: value }] })).toBeNull();
  });

  it('refuses a malformed line even after a valid line', () => {
    expect(parseOrderFired({ ...fired, items: [item, null] })).toBeNull();
  });

  it.each(['preparing', 'ready', 'served'])('accepts kitchen status %s', kitchen_status => {
    const update = { ...status, kitchen_status, table_number: '4' };
    expect(parseOrderItemStatus(update)).toEqual(update);
    expect(parseOrderItemStatus(status)).toEqual(status);
  });

  it.each([
    ['item_id', ''], ['item_id', 1], ['order_id', ''], ['order_id', 1],
    ['kitchen_status', 'pending'], ['kitchen_status', 1], ['at', 1], ['at', 'yesterday'],
    ['order_number', 1], ['order_type', 1], ['table_number', 4],
  ])('refuses invalid kitchen field %s', (field, value) => {
    expect(parseOrderItemStatus({ ...status, [field]: value })).toBeNull();
  });
});
