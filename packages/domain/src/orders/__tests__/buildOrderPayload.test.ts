// packages/domain/src/orders/__tests__/buildOrderPayload.test.ts
import { describe, it, expect } from 'vitest';
import { buildOrderPayload } from '../buildOrderPayload';
import type { Cart, PaymentInput } from '../../types/index.js';

describe('buildOrderPayload', () => {
  it('transforms cart to RPC payload (with modifiers carried through)', () => {
    const cart: Cart = {
      order_type: 'dine_in',
      items: [
        { id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 2, modifiers: [] },
      ],
    };
    const payment: PaymentInput = { method: 'cash', amount: 70000, cash_received: 100000, change_given: 30000 };
    const payload = buildOrderPayload('session-1', cart, payment);
    expect(payload).toEqual({
      session_id: 'session-1',
      order_type: 'dine_in',
      items: [{ product_id: 'p1', quantity: 2, unit_price: 35000, modifiers: [] }],
      payment: { method: 'cash', amount: 70000, cash_received: 100000, change_given: 30000 },
    });
    // No idempotency_key when not supplied (exactOptionalPropertyTypes-safe)
    expect('idempotency_key' in payload).toBe(false);
  });

  it('preserves modifier snapshot in the payload', () => {
    const cart: Cart = {
      order_type: 'dine_in',
      items: [
        {
          id: 'l1',
          product_id: 'p1',
          name: 'Americano',
          unit_price: 35000,
          quantity: 1,
          modifiers: [
            { group_name: 'Temperature', option_label: 'Hot', price_adjustment: 0 },
            { group_name: 'Milk', option_label: 'Oat milk', price_adjustment: 5000 },
          ],
        },
      ],
    };
    const payment: PaymentInput = { method: 'cash', amount: 40000, cash_received: 40000, change_given: 0 };
    const payload = buildOrderPayload('s', cart, payment);
    expect(payload.items[0]?.modifiers).toEqual([
      { group_name: 'Temperature', option_label: 'Hot', price_adjustment: 0 },
      { group_name: 'Milk', option_label: 'Oat milk', price_adjustment: 5000 },
    ]);
  });

  it('includes idempotency_key when supplied (D8)', () => {
    const cart: Cart = {
      order_type: 'take_out',
      items: [{ id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 40000, quantity: 1, modifiers: [] }],
    };
    const payment: PaymentInput = { method: 'card', amount: 40000 };
    const key = '11111111-2222-4333-8444-555555555555';
    const payload = buildOrderPayload('session-1', cart, payment, key);
    expect(payload.idempotency_key).toBe(key);
  });

  it('omits idempotency_key when undefined', () => {
    const cart: Cart = {
      order_type: 'take_out',
      items: [{ id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 40000, quantity: 1, modifiers: [] }],
    };
    const payment: PaymentInput = { method: 'card', amount: 40000 };
    const payload = buildOrderPayload('session-1', cart, payment, undefined);
    expect('idempotency_key' in payload).toBe(false);
  });

  it('includes customer_id when cart has customerId', () => {
    const cart: Cart = {
      order_type: 'dine_in',
      items: [{ id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 40000, quantity: 1, modifiers: [] }],
      customerId: 'cust-uuid-1',
    };
    const payment: PaymentInput = { method: 'cash', amount: 40000, cash_received: 40000, change_given: 0 };
    const payload = buildOrderPayload('session-1', cart, payment);
    expect(payload.customer_id).toBe('cust-uuid-1');
  });

  it('omits customer_id when cart has no customerId', () => {
    const cart: Cart = {
      order_type: 'dine_in',
      items: [{ id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 40000, quantity: 1, modifiers: [] }],
    };
    const payment: PaymentInput = { method: 'cash', amount: 40000, cash_received: 40000, change_given: 0 };
    const payload = buildOrderPayload('session-1', cart, payment);
    expect('customer_id' in payload).toBe(false);
  });

  it('includes loyalty_points_redeemed when cart has redemption', () => {
    const cart: Cart = {
      order_type: 'dine_in',
      items: [{ id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 40000, quantity: 1, modifiers: [] }],
      customerId: 'cust-uuid-1',
      loyaltyPointsToRedeem: 500,
    };
    const payment: PaymentInput = { method: 'cash', amount: 35000, cash_received: 35000, change_given: 0 };
    const payload = buildOrderPayload('session-1', cart, payment);
    expect(payload.loyalty_points_redeemed).toBe(500);
  });

  it('omits loyalty_points_redeemed when zero', () => {
    const cart: Cart = {
      order_type: 'dine_in',
      items: [{ id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 40000, quantity: 1, modifiers: [] }],
      customerId: 'cust-uuid-1',
      loyaltyPointsToRedeem: 0,
    };
    const payment: PaymentInput = { method: 'cash', amount: 40000, cash_received: 40000, change_given: 0 };
    const payload = buildOrderPayload('session-1', cart, payment);
    expect('loyalty_points_redeemed' in payload).toBe(false);
  });

  it('includes table_number when cart has tableNumber', () => {
    const cart: Cart = {
      order_type: 'dine_in',
      items: [{ id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 40000, quantity: 1, modifiers: [] }],
      tableNumber: 'T-03',
    };
    const payment: PaymentInput = { method: 'cash', amount: 40000, cash_received: 40000, change_given: 0 };
    const payload = buildOrderPayload('session-1', cart, payment);
    expect(payload.table_number).toBe('T-03');
  });

  it('omits table_number when cart has no tableNumber', () => {
    const cart: Cart = {
      order_type: 'dine_in',
      items: [{ id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 40000, quantity: 1, modifiers: [] }],
    };
    const payment: PaymentInput = { method: 'cash', amount: 40000, cash_received: 40000, change_given: 0 };
    const payload = buildOrderPayload('session-1', cart, payment);
    expect('table_number' in payload).toBe(false);
  });

  it('omits table_number when cart tableNumber is null', () => {
    const cart: Cart = {
      order_type: 'dine_in',
      items: [{ id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 40000, quantity: 1, modifiers: [] }],
      tableNumber: null,
    };
    const payment: PaymentInput = { method: 'cash', amount: 40000, cash_received: 40000, change_given: 0 };
    const payload = buildOrderPayload('session-1', cart, payment);
    expect('table_number' in payload).toBe(false);
  });

  // Session 6: cart discount
  it('includes discount_* when cart has cartDiscount', () => {
    const cart: Cart = {
      order_type: 'dine_in',
      items: [{ id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 40000, quantity: 1, modifiers: [] }],
      cartDiscount: { type: 'percentage', value: 10, amount: 4000, reason: 'Staff meal' },
    };
    const payment: PaymentInput = { method: 'cash', amount: 36000, cash_received: 36000, change_given: 0 };
    const payload = buildOrderPayload('session-1', cart, payment);
    expect(payload.discount_amount).toBe(4000);
    expect(payload.discount_type).toBe('percentage');
    expect(payload.discount_value).toBe(10);
    expect(payload.discount_reason).toBe('Staff meal');
    expect('discount_authorized_by' in payload).toBe(false);
  });

  it('includes discount_authorized_by when cart discount has authorized_by', () => {
    const cart: Cart = {
      order_type: 'dine_in',
      items: [{ id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 40000, quantity: 1, modifiers: [] }],
      cartDiscount: { type: 'percentage', value: 15, amount: 6000, reason: 'Manager comp', authorized_by: 'mgr-uuid' },
    };
    const payment: PaymentInput = { method: 'cash', amount: 34000, cash_received: 34000, change_given: 0 };
    const payload = buildOrderPayload('session-1', cart, payment);
    expect(payload.discount_authorized_by).toBe('mgr-uuid');
  });

  it('omits discount_* when cart has no cartDiscount', () => {
    const cart: Cart = {
      order_type: 'dine_in',
      items: [{ id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 40000, quantity: 1, modifiers: [] }],
    };
    const payment: PaymentInput = { method: 'cash', amount: 40000, cash_received: 40000, change_given: 0 };
    const payload = buildOrderPayload('session-1', cart, payment);
    expect('discount_amount' in payload).toBe(false);
    expect('discount_type' in payload).toBe(false);
  });

  // Session 6: line discount
  it('includes discount_* on item when item has discount', () => {
    const cart: Cart = {
      order_type: 'dine_in',
      items: [{
        id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 40000, quantity: 1, modifiers: [],
        discount: { type: 'fixed_amount', value: 5000, amount: 5000, reason: 'Damage' },
      }],
    };
    const payment: PaymentInput = { method: 'cash', amount: 35000, cash_received: 35000, change_given: 0 };
    const payload = buildOrderPayload('session-1', cart, payment);
    expect(payload.items[0]?.discount_amount).toBe(5000);
    expect(payload.items[0]?.discount_type).toBe('fixed_amount');
    expect(payload.items[0]?.discount_reason).toBe('Damage');
  });

  it('omits discount_* on item when item has no discount', () => {
    const cart: Cart = {
      order_type: 'dine_in',
      items: [{ id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 40000, quantity: 1, modifiers: [] }],
    };
    const payment: PaymentInput = { method: 'cash', amount: 40000, cash_received: 40000, change_given: 0 };
    const payload = buildOrderPayload('session-1', cart, payment);
    expect('discount_amount' in (payload.items[0] ?? {})).toBe(false);
  });

  // Session 6: loyalty_multiplier
  it('includes loyalty_multiplier=1.1 for Gold customer (lifetime >= 2000)', () => {
    const cart: Cart = {
      order_type: 'dine_in',
      items: [{ id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 35000, quantity: 1, modifiers: [] }],
      customerId: 'cust-gold',
    };
    const payment: PaymentInput = { method: 'cash', amount: 35000, cash_received: 35000, change_given: 0 };
    const payload = buildOrderPayload('session-1', cart, payment, undefined, 2500);
    expect(payload.loyalty_multiplier).toBe(1.1);
  });

  it('omits loyalty_multiplier when Bronze (multiplier=1.0)', () => {
    const cart: Cart = {
      order_type: 'dine_in',
      items: [{ id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 35000, quantity: 1, modifiers: [] }],
      customerId: 'cust-bronze',
    };
    const payment: PaymentInput = { method: 'cash', amount: 35000, cash_received: 35000, change_given: 0 };
    const payload = buildOrderPayload('session-1', cart, payment, undefined, 100);
    expect('loyalty_multiplier' in payload).toBe(false);
  });

  it('omits loyalty_multiplier when no customer', () => {
    const cart: Cart = {
      order_type: 'dine_in',
      items: [{ id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 35000, quantity: 1, modifiers: [] }],
    };
    const payment: PaymentInput = { method: 'cash', amount: 35000, cash_received: 35000, change_given: 0 };
    const payload = buildOrderPayload('session-1', cart, payment);
    expect('loyalty_multiplier' in payload).toBe(false);
  });
});
