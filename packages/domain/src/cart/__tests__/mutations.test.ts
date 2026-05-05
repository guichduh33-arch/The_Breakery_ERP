// packages/domain/src/cart/__tests__/mutations.test.ts
import { describe, it, expect } from 'vitest';
import { addItem, updateQuantity, removeItem, clearCart, setOrderType, attachCustomer, detachCustomer, setRedeemPoints } from '../mutations';
import type { Cart, Product } from '../../types/index.js';

const product: Product = {
  id: 'p1', sku: 'SKU', name: 'Americano', category_id: 'c1', retail_price: 35000,
  tax_inclusive: true, image_url: null, current_stock: 50, is_active: true, is_favorite: false,
};

const empty: Cart = { items: [], order_type: 'dine_in' };

describe('addItem', () => {
  it('adds new item with qty=1 and a stable id', () => {
    const c = addItem(empty, product);
    expect(c.items).toHaveLength(1);
    expect(c.items[0]).toMatchObject({
      product_id: 'p1',
      name: 'Americano',
      unit_price: 35000,
      quantity: 1,
      modifiers: [],
    });
    expect(c.items[0]?.id).toBeTypeOf('string');
    expect(c.items[0]?.id.length).toBeGreaterThan(0);
  });
  it('increments existing item quantity when modifiers match', () => {
    const c = addItem(addItem(empty, product), product);
    expect(c.items).toHaveLength(1);
    expect(c.items[0]?.quantity).toBe(2);
  });
  it('creates a separate line when modifiers differ', () => {
    const hot = [{ group_name: 'Temperature', option_label: 'Hot', price_adjustment: 0 }];
    const ice = [{ group_name: 'Temperature', option_label: 'Ice', price_adjustment: 0 }];
    const c1 = addItem(empty, product, hot);
    const c2 = addItem(c1, product, ice);
    expect(c2.items).toHaveLength(2);
    expect(c2.items[0]?.modifiers[0]?.option_label).toBe('Hot');
    expect(c2.items[1]?.modifiers[0]?.option_label).toBe('Ice');
  });
  it('merges identical modifier sets regardless of order', () => {
    const a = [
      { group_name: 'Temperature', option_label: 'Hot', price_adjustment: 0 },
      { group_name: 'Milk', option_label: 'Oat milk', price_adjustment: 5000 },
    ];
    const b = [
      { group_name: 'Milk', option_label: 'Oat milk', price_adjustment: 5000 },
      { group_name: 'Temperature', option_label: 'Hot', price_adjustment: 0 },
    ];
    const c = addItem(addItem(empty, product, a), product, b);
    expect(c.items).toHaveLength(1);
    expect(c.items[0]?.quantity).toBe(2);
  });
  it('does not mutate input', () => {
    addItem(empty, product);
    expect(empty.items).toHaveLength(0);
  });
});

describe('updateQuantity', () => {
  it('updates qty by line id', () => {
    const c1 = addItem(empty, product);
    const id = c1.items[0]!.id;
    const c2 = updateQuantity(c1, id, 5);
    expect(c2.items[0]?.quantity).toBe(5);
  });
  it('removes item if qty <= 0', () => {
    const c1 = addItem(empty, product);
    const id = c1.items[0]!.id;
    const c2 = updateQuantity(c1, id, 0);
    expect(c2.items).toHaveLength(0);
  });
  it('returns same cart if id not found', () => {
    const c1 = addItem(empty, product);
    const c2 = updateQuantity(c1, 'unknown', 5);
    expect(c2).toEqual(c1);
  });
});

describe('removeItem', () => {
  it('removes by line id', () => {
    const c1 = addItem(empty, product);
    const id = c1.items[0]!.id;
    const c2 = removeItem(c1, id);
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

describe('attachCustomer', () => {
  it('sets customerId on cart', () => {
    const c = attachCustomer(empty, 'cust-1');
    expect(c.customerId).toBe('cust-1');
  });

  it('preserves existing items and order_type', () => {
    const cart: Cart = { ...empty, items: [{ id: 'l1', product_id: 'p1', name: 'X', unit_price: 1000, quantity: 1, modifiers: [] }] };
    const c = attachCustomer(cart, 'cust-2');
    expect(c.items).toHaveLength(1);
    expect(c.customerId).toBe('cust-2');
  });
});

describe('detachCustomer', () => {
  it('removes customerId and loyaltyPointsToRedeem', () => {
    const cart: Cart = { ...empty, customerId: 'cust-1', loyaltyPointsToRedeem: 200 };
    const c = detachCustomer(cart);
    expect(c.customerId).toBeUndefined();
    expect(c.loyaltyPointsToRedeem).toBeUndefined();
  });

  it('is a no-op when no customer attached', () => {
    const c = detachCustomer(empty);
    expect(c.customerId).toBeUndefined();
  });
});

describe('setRedeemPoints', () => {
  it('sets loyaltyPointsToRedeem', () => {
    const c = setRedeemPoints(empty, 500);
    expect(c.loyaltyPointsToRedeem).toBe(500);
  });

  it('resets to 0 when called with 0', () => {
    const cart: Cart = { ...empty, loyaltyPointsToRedeem: 500 };
    const c = setRedeemPoints(cart, 0);
    expect(c.loyaltyPointsToRedeem).toBe(0);
  });
});
