// apps/pos/src/features/lan/__tests__/busTopics.test.ts
// Spec 006x lot 3 — gardes de parsing des payloads métier du bus (JSON non
// fiable : tout champ manquant/mal typé rejette le message entier).
import { describe, it, expect } from 'vitest';
import { parseOrderFired, parseOrderItemStatus } from '../busTopics';
import { nextLocalOrderNumber } from '../localOrderNumber';

const FIRED = {
  client_uuid: 'u1',
  order_number: 'L-3',
  order_type: 'take_out',
  table_number: null,
  notes: null,
  fired_at: '2026-07-20T10:00:00.000Z',
  items: [{
    id: 'i1', product_id: 'p1', product_name: 'Croissant', quantity: 1, unit_price: 15000,
    modifiers: [], dispatch_stations: ['kitchen'],
  }],
};

const STATUS = {
  item_id: 'i1', order_id: 'u1', kitchen_status: 'ready', at: '2026-07-20T10:05:00.000Z',
  order_number: 'L-3', order_type: 'take_out', table_number: null,
};

describe('parseOrderFired', () => {
  it('accepts a valid payload', () => {
    expect(parseOrderFired(FIRED)).toEqual(FIRED);
  });
  it.each([
    ['items vides', { ...FIRED, items: [] }],
    ['quantity 0', { ...FIRED, items: [{ ...FIRED.items[0], quantity: 0 }] }],
    ['fired_at invalide', { ...FIRED, fired_at: 'not-a-date' }],
    ['client_uuid manquant', { ...FIRED, client_uuid: '' }],
    ['modifier mal typé', { ...FIRED, items: [{ ...FIRED.items[0], modifiers: [{ nope: 1 }] }] }],
  ])('rejette : %s', (_label, bad) => {
    expect(parseOrderFired(bad)).toBeNull();
  });
});

describe('parseOrderItemStatus', () => {
  it('accepts a valid payload', () => {
    expect(parseOrderItemStatus(STATUS)).toEqual(STATUS);
  });
  it.each([
    ['statut inconnu', { ...STATUS, kitchen_status: 'pending' }],
    ['item_id vide', { ...STATUS, item_id: '' }],
    ['table mal typée', { ...STATUS, table_number: 5 }],
  ])('rejette : %s', (_label, bad) => {
    expect(parseOrderItemStatus(bad)).toBeNull();
  });
});

describe('nextLocalOrderNumber', () => {
  it('increments a per-terminal L- sequence in the given storage', () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => { mem.set(k, v); },
    } as unknown as Storage;
    expect(nextLocalOrderNumber(storage)).toBe('L-1');
    expect(nextLocalOrderNumber(storage)).toBe('L-2');
  });

  it('survives a broken storage (compteur volatile)', () => {
    const broken = {
      getItem: () => { throw new Error('nope'); },
      setItem: () => { throw new Error('nope'); },
    } as unknown as Storage;
    expect(nextLocalOrderNumber(broken)).toBe('L-1');
  });
});
