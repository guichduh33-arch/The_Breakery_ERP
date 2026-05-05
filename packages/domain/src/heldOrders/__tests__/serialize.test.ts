import { describe, it, expect } from 'vitest';
import { toHeldOrder, fromHeldOrder } from '../serialize';
import type { Cart, CartItem } from '../../types/cart';

const modifier = { group_name: 'Milk', option_label: 'Oat milk', price_adjustment: 0.5 };

const item: CartItem = {
  id: 'line-1',
  product_id: 'prod-1',
  name: 'Latte',
  unit_price: 4.5,
  quantity: 2,
  modifiers: [modifier],
};

const cart: Cart = {
  items: [item],
  order_type: 'dine_in',
  customerId: 'cust-abc',
  loyaltyPointsToRedeem: 50,
};

describe('toHeldOrder', () => {
  it('generates a valid UUID when no id provided', () => {
    const held = toHeldOrder(cart);
    expect(held.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('uses explicit id when provided', () => {
    const held = toHeldOrder(cart, { id: 'my-id' });
    expect(held.id).toBe('my-id');
  });

  it('generates a valid ISO timestamp for heldAt', () => {
    const held = toHeldOrder(cart);
    expect(new Date(held.heldAt).toISOString()).toBe(held.heldAt);
  });

  it('preserves items with modifiers', () => {
    const held = toHeldOrder(cart);
    expect(held.cart.items).toHaveLength(1);
    expect(held.cart.items[0]!.modifiers).toEqual([modifier]);
  });

  it('preserves customerId', () => {
    const held = toHeldOrder(cart);
    expect(held.cart.customerId).toBe('cust-abc');
  });

  it('preserves loyaltyPointsToRedeem', () => {
    const held = toHeldOrder(cart);
    expect(held.cart.loyaltyPointsToRedeem).toBe(50);
  });

  it('preserves orderType derived from order_type', () => {
    const held = toHeldOrder(cart);
    expect(held.cart.orderType).toBe('dine_in');
  });

  it('maps take_out order_type correctly', () => {
    const takeOutCart: Cart = { ...cart, order_type: 'take_out' };
    const held = toHeldOrder(takeOutCart);
    expect(held.cart.orderType).toBe('take_out');
  });

  it('maps delivery order_type to take_out', () => {
    const deliveryCart: Cart = { ...cart, order_type: 'delivery' };
    const held = toHeldOrder(deliveryCart);
    expect(held.cart.orderType).toBe('take_out');
  });

  it('captures explicit orderType from opts', () => {
    const held = toHeldOrder(cart, { orderType: 'take_out' });
    expect(held.cart.orderType).toBe('take_out');
  });

  it('stores tableNumber from opts', () => {
    const held = toHeldOrder(cart, { tableNumber: 'T-03' });
    expect(held.cart.tableNumber).toBe('T-03');
  });

  it('defaults tableNumber to null when not provided', () => {
    const held = toHeldOrder(cart);
    expect(held.cart.tableNumber).toBeNull();
  });

  it('stores notes when provided', () => {
    const held = toHeldOrder(cart, { notes: 'for Mr. Tan' });
    expect(held.notes).toBe('for Mr. Tan');
  });

  it('omits notes field when not provided', () => {
    const held = toHeldOrder(cart);
    expect(held.notes).toBeUndefined();
  });

  it('snapshots items (deep copy — mutating original does not affect held)', () => {
    const held = toHeldOrder(cart);
    item.modifiers.push({ group_name: 'Extras', option_label: 'Extra shot', price_adjustment: 0.75 });
    expect(held.cart.items[0]!.modifiers).toHaveLength(1);
    item.modifiers.pop();
  });
});

describe('fromHeldOrder', () => {
  it('round-trips items with modifiers', () => {
    const held = toHeldOrder(cart, { tableNumber: 'T-01', notes: 'vip' });
    const restored = fromHeldOrder(held);
    expect(restored.items[0]).toEqual(item);
  });

  it('round-trips customerId', () => {
    const held = toHeldOrder(cart);
    const restored = fromHeldOrder(held);
    expect(restored.customerId).toBe('cust-abc');
  });

  it('round-trips loyaltyPointsToRedeem', () => {
    const held = toHeldOrder(cart);
    const restored = fromHeldOrder(held);
    expect(restored.loyaltyPointsToRedeem).toBe(50);
  });

  it('round-trips orderType as order_type', () => {
    const held = toHeldOrder(cart);
    const restored = fromHeldOrder(held);
    expect(restored.order_type).toBe('dine_in');
  });

  it('sets customerId to undefined when held has null', () => {
    const noCustomerCart: Cart = { items: cart.items, order_type: cart.order_type };
    const held = toHeldOrder(noCustomerCart);
    const restored = fromHeldOrder(held);
    expect(restored.customerId).toBeUndefined();
  });

  it('restores items as deep copy (mutating restored does not affect held)', () => {
    const held = toHeldOrder(cart);
    const restored = fromHeldOrder(held);
    restored.items[0]!.modifiers.push({ group_name: 'G', option_label: 'X', price_adjustment: 0 });
    expect(held.cart.items[0]!.modifiers).toHaveLength(1);
  });
});
