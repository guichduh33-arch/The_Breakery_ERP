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
});
