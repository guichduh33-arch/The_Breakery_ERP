import { describe, expect, it } from 'vitest';
import { addItem, addComboItem } from '../mutations.js';
import type { Cart, Product } from '../../types/index.js';

const product = { id: 'coffee', name: 'Coffee', retail_price: 20_000, product_type: 'finished' } as Product;
const base: Cart = { order_type: 'take_out', items: [{ id: 'sent', product_id: product.id,
  name: product.name, unit_price: 20_000, quantity: 1, modifiers: [] }] };

describe('frontière entre brouillon et lignes engagées', () => {
  it.each(['sealed', 'cancelled', 'discounted', 'persisted'])('%s : un nouvel ajout crée une ligne', (kind) => {
    const item = { ...base.items[0]!, ...(kind === 'cancelled' ? { is_cancelled: true } : {}),
      ...(kind === 'persisted' ? { server_id: 'db' } : {}),
      ...(kind === 'discounted' ? { discount: { type: 'fixed_amount' as const, value: 1, amount: 1, reason: 'Test discount' } } : {}) };
    const result = addItem({ ...base, items: [item] }, product, [], 1, undefined, kind === 'sealed' ? ['sent'] : []);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.quantity).toBe(1);
  });
  it('fusionne les brouillons identiques, sépare les prix différents', () => {
    expect(addItem(base, product).items[0]?.quantity).toBe(2);
    expect(addItem(base, product, [], 1, 19_000).items).toHaveLength(2);
  });
  it('protège également les combos envoyés', () => {
    const combo = { ...product, product_type: 'combo' as const };
    const components = [{ product_id: 'milk', quantity: 1 }];
    const first = addComboItem({ ...base, items: [] }, combo, [], components);
    const next = addComboItem(first, combo, [], components, 1, undefined, [first.items[0]!.id]);
    expect(next.items).toHaveLength(2);
  });
});
