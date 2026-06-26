// packages/domain/src/printing/__tests__/groupItemsByStation.test.ts
import { describe, expect, it } from 'vitest';
import { groupItemsByStation } from '../groupItemsByStation.js';
import type { DispatchStation } from '../../kitchen/types.js';
import type { CartItem } from '../../types/cart.js';

function item(id: string, product_id: string, extra: Partial<CartItem> = {}): CartItem {
  return { id, product_id, name: product_id, unit_price: 1000, quantity: 1, modifiers: [], ...extra };
}

const stations: Record<string, DispatchStation> = {
  latte: 'barista',
  sandwich: 'kitchen',
  croissant: 'display',
  baguette: 'display',
  ingredient: 'none',
};

describe('groupItemsByStation', () => {
  it('groups items into their prep station buckets', () => {
    const out = groupItemsByStation(
      [item('l1', 'latte'), item('s1', 'sandwich'), item('c1', 'croissant'), item('b1', 'baguette')],
      stations,
    );
    expect(out.barista?.map((i) => i.id)).toEqual(['l1']);
    expect(out.kitchen?.map((i) => i.id)).toEqual(['s1']);
    expect(out.display?.map((i) => i.id)).toEqual(['c1', 'b1']);
  });

  it("ignores items mapped to 'none' or unmapped", () => {
    const out = groupItemsByStation(
      [item('i1', 'ingredient'), item('x1', 'unknown_product')],
      stations,
    );
    expect(out).toEqual({});
  });

  it('skips cancelled lines (never printed)', () => {
    const out = groupItemsByStation(
      [item('s1', 'sandwich', { is_cancelled: true }), item('s2', 'sandwich')],
      stations,
    );
    expect(out.kitchen?.map((i) => i.id)).toEqual(['s2']);
  });

  it('returns an empty object for an empty cart', () => {
    expect(groupItemsByStation([], stations)).toEqual({});
  });

  it('preserves input (FIFO) order within a bucket', () => {
    const out = groupItemsByStation(
      [item('c2', 'croissant'), item('c1', 'croissant'), item('c3', 'croissant')],
      stations,
    );
    expect(out.display?.map((i) => i.id)).toEqual(['c2', 'c1', 'c3']);
  });
});
