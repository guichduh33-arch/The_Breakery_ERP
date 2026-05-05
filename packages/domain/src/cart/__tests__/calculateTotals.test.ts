// packages/domain/src/cart/__tests__/calculateTotals.test.ts
import { describe, it, expect } from 'vitest';
import { calculateTotals, RedemptionExceedsTotalError } from '../calculateTotals';
import type { Cart } from '../../types/index.js';

const TAX_RATE = 0.10;

describe('calculateTotals', () => {
  it('returns zero for empty cart', () => {
    const cart: Cart = { items: [], order_type: 'dine_in' };
    expect(calculateTotals(cart, TAX_RATE)).toEqual({
      subtotal: 0,
      tax_amount: 0,
      total: 0,
      item_count: 0,
      redemption_amount: 0,
    });
  });

  it('sums one item correctly with PB1 incluse extracted', () => {
    const cart: Cart = {
      items: [{ id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] }],
      order_type: 'dine_in',
    };
    const t = calculateTotals(cart, TAX_RATE);
    expect(t.subtotal).toBe(35000);
    expect(t.total).toBe(35000);
    expect(t.redemption_amount).toBe(0);
    // Tax extracted = 35000 * 0.1 / 1.1 = 3181.81 → rounded to 3200
    expect(t.tax_amount).toBe(3200);
    expect(t.item_count).toBe(1);
  });

  it('sums multiple items', () => {
    const cart: Cart = {
      items: [
        { id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] },
        { id: 'l2', product_id: 'p2', name: 'Flat White', unit_price: 45000, quantity: 1, modifiers: [] },
      ],
      order_type: 'dine_in',
    };
    const t = calculateTotals(cart, TAX_RATE);
    expect(t.subtotal).toBe(80000);
    expect(t.total).toBe(80000);
    expect(t.redemption_amount).toBe(0);
    // 80000 * 0.1 / 1.1 = 7272.72 → 7300
    expect(t.tax_amount).toBe(7300);
    expect(t.item_count).toBe(2);
  });

  it('handles quantities > 1', () => {
    const cart: Cart = {
      items: [{ id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 3, modifiers: [] }],
      order_type: 'dine_in',
    };
    const t = calculateTotals(cart, TAX_RATE);
    expect(t.subtotal).toBe(105000);
    expect(t.item_count).toBe(3);
  });

  it('rounds line totals individually then sums', () => {
    const cart: Cart = {
      items: [{ id: 'l1', product_id: 'p1', name: 'Test', unit_price: 333, quantity: 3, modifiers: [] }],
      order_type: 'dine_in',
    };
    const t = calculateTotals(cart, TAX_RATE);
    // 333 * 3 = 999 → round 1000
    expect(t.subtotal).toBe(1000);
  });

  it('factors modifier price_adjustment per unit then per quantity', () => {
    const cart: Cart = {
      items: [
        {
          id: 'l1',
          product_id: 'p1',
          name: 'Americano + Oat',
          unit_price: 35000,
          quantity: 2,
          modifiers: [
            { group_name: 'Temperature', option_label: 'Hot', price_adjustment: 0 },
            { group_name: 'Milk', option_label: 'Oat milk', price_adjustment: 5000 },
          ],
        },
      ],
      order_type: 'dine_in',
    };
    const t = calculateTotals(cart, TAX_RATE);
    // (35000 + 5000) * 2 = 80000
    expect(t.subtotal).toBe(80000);
    expect(t.item_count).toBe(2);
  });

  it('subtracts redemption_amount from total and recalculates tax', () => {
    const cart: Cart = {
      items: [{ id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] }],
      order_type: 'dine_in',
      loyaltyPointsToRedeem: 500,
    };
    const t = calculateTotals(cart, TAX_RATE);
    expect(t.subtotal).toBe(35000);
    expect(t.redemption_amount).toBe(5000);
    expect(t.total).toBe(30000);
    // 30000 * 0.1 / 1.1 = 2727.27 → roundIdr → 2700
    expect(t.tax_amount).toBe(2700);
  });

  it('returns redemption_amount=0 when no points redeemed', () => {
    const cart: Cart = {
      items: [{ id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] }],
      order_type: 'dine_in',
    };
    expect(calculateTotals(cart, TAX_RATE).redemption_amount).toBe(0);
  });

  it('throws RedemptionExceedsTotalError when redemption exceeds items total', () => {
    const cart: Cart = {
      items: [{ id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 5000, quantity: 1, modifiers: [] }],
      order_type: 'dine_in',
      loyaltyPointsToRedeem: 1000,
    };
    expect(() => calculateTotals(cart, TAX_RATE)).toThrow(RedemptionExceedsTotalError);
  });
});
