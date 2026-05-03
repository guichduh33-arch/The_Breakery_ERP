// packages/domain/src/cart/__tests__/mutations.test.ts
import { describe, it, expect } from 'vitest';
import { addItem, updateQuantity, removeItem, clearCart, setOrderType } from '../mutations';
import type { Cart, Product } from '../../types/index.js';

const product: Product = {
  id: 'p1', sku: 'SKU', name: 'Americano', category_id: 'c1', retail_price: 35000,
  tax_inclusive: true, image_url: null, current_stock: 50, is_active: true, is_favorite: false,
};

const empty: Cart = { items: [], order_type: 'dine_in' };

describe('addItem', () => {
  it('adds new item with qty=1', () => {
    const c = addItem(empty, product);
    expect(c.items).toHaveLength(1);
    expect(c.items[0]).toMatchObject({ product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1 });
  });
  it('increments existing item quantity', () => {
    const c = addItem(addItem(empty, product), product);
    expect(c.items).toHaveLength(1);
    expect(c.items[0]?.quantity).toBe(2);
  });
  it('does not mutate input', () => {
    addItem(empty, product);
    expect(empty.items).toHaveLength(0);
  });
});

describe('updateQuantity', () => {
  it('updates qty', () => {
    const c1 = addItem(empty, product);
    const c2 = updateQuantity(c1, 'p1', 5);
    expect(c2.items[0]?.quantity).toBe(5);
  });
  it('removes item if qty <= 0', () => {
    const c1 = addItem(empty, product);
    const c2 = updateQuantity(c1, 'p1', 0);
    expect(c2.items).toHaveLength(0);
  });
  it('returns same cart if id not found', () => {
    const c1 = addItem(empty, product);
    const c2 = updateQuantity(c1, 'unknown', 5);
    expect(c2).toEqual(c1);
  });
});

describe('removeItem', () => {
  it('removes by id', () => {
    const c1 = addItem(empty, product);
    const c2 = removeItem(c1, 'p1');
    expect(c2.items).toHaveLength(0);
  });
});

describe('clearCart', () => {
  it('keeps order_type, empties items', () => {
    const c1 = addItem({ ...empty, order_type: 'take_out' }, product);
    const c2 = clearCart(c1);
    expect(c2.items).toHaveLength(0);
    expect(c2.order_type).toBe('take_out');
  });
});

describe('setOrderType', () => {
  it('changes order_type', () => {
    const c = setOrderType(empty, 'delivery');
    expect(c.order_type).toBe('delivery');
    expect(c.items).toHaveLength(0);
  });
});
