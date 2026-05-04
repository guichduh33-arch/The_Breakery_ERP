// packages/domain/src/orders/__tests__/buildOrderPayload.test.ts
import { describe, it, expect } from 'vitest';
import { buildOrderPayload } from '../buildOrderPayload';
import type { Cart, PaymentInput } from '../../types/index.js';

describe('buildOrderPayload', () => {
  it('transforms cart to RPC payload', () => {
    const cart: Cart = {
      order_type: 'dine_in',
      items: [
        { product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 2 },
      ],
    };
    const payment: PaymentInput = { method: 'cash', amount: 70000, cash_received: 100000, change_given: 30000 };
    const payload = buildOrderPayload('session-1', cart, payment);
    expect(payload).toEqual({
      session_id: 'session-1',
      order_type: 'dine_in',
      items: [{ product_id: 'p1', quantity: 2, unit_price: 35000 }],
      payment: { method: 'cash', amount: 70000, cash_received: 100000, change_given: 30000 },
    });
    // No idempotency_key when not supplied (exactOptionalPropertyTypes-safe)
    expect('idempotency_key' in payload).toBe(false);
  });

  it('includes idempotency_key when supplied (D8)', () => {
    const cart: Cart = {
      order_type: 'take_out',
      items: [{ product_id: 'p1', name: 'Latte', unit_price: 40000, quantity: 1 }],
    };
    const payment: PaymentInput = { method: 'card', amount: 40000 };
    const key = '11111111-2222-4333-8444-555555555555';
    const payload = buildOrderPayload('session-1', cart, payment, key);
    expect(payload.idempotency_key).toBe(key);
  });

  it('omits idempotency_key when undefined', () => {
    const cart: Cart = {
      order_type: 'take_out',
      items: [{ product_id: 'p1', name: 'Latte', unit_price: 40000, quantity: 1 }],
    };
    const payment: PaymentInput = { method: 'card', amount: 40000 };
    const payload = buildOrderPayload('session-1', cart, payment, undefined);
    expect('idempotency_key' in payload).toBe(false);
  });
});
