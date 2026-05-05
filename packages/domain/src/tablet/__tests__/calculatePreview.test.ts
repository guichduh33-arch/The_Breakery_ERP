import { describe, it, expect } from 'vitest';
import { calculatePreview } from '../calculatePreview';
import type { TabletCart } from '../types';

const emptyCart: TabletCart = {
  items: [],
  tableNumber: null,
  orderType: 'dine_in',
};

describe('calculatePreview', () => {
  it('returns 0/0 for empty cart', () => {
    const result = calculatePreview(emptyCart);
    expect(result.items_total).toBe(0);
    expect(result.tax_amount).toBe(0);
  });

  it('sums unit_price × quantity (no modifiers)', () => {
    const cart: TabletCart = {
      ...emptyCart,
      items: [
        { id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 2, modifiers: [] },
      ],
    };
    const result = calculatePreview(cart);
    expect(result.items_total).toBe(70000);
  });

  it('includes modifier price_adjustment in items_total', () => {
    const cart: TabletCart = {
      ...emptyCart,
      items: [
        {
          id: 'l1',
          product_id: 'p1',
          name: 'Latte',
          unit_price: 40000,
          quantity: 2,
          modifiers: [{ group_name: 'Milk', option_label: 'Oat milk', price_adjustment: 5000 }],
        },
      ],
    };
    const result = calculatePreview(cart);
    // (40000 + 5000) × 2 = 90000
    expect(result.items_total).toBe(90000);
  });

  it('sums multiple items with different modifiers', () => {
    const cart: TabletCart = {
      ...emptyCart,
      items: [
        { id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] },
        {
          id: 'l2',
          product_id: 'p2',
          name: 'Latte',
          unit_price: 40000,
          quantity: 1,
          modifiers: [{ group_name: 'Milk', option_label: 'Oat milk', price_adjustment: 5000 }],
        },
      ],
    };
    const result = calculatePreview(cart);
    // 35000 + (40000 + 5000) = 80000
    expect(result.items_total).toBe(80000);
  });

  it('extracts tax using PB1 included convention: round(items_total * 10/110)', () => {
    const cart: TabletCart = {
      ...emptyCart,
      items: [
        { id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 110000, quantity: 1, modifiers: [] },
      ],
    };
    const result = calculatePreview(cart);
    expect(result.items_total).toBe(110000);
    expect(result.tax_amount).toBe(Math.round(110000 * 10 / 110));
  });

  it('tax_amount matches Math.round(items_total × 10/110) for various totals', () => {
    const cases = [35000, 70000, 125000, 250000];
    for (const unitPrice of cases) {
      const cart: TabletCart = {
        ...emptyCart,
        items: [{ id: 'l1', product_id: 'p1', name: 'Item', unit_price: unitPrice, quantity: 1, modifiers: [] }],
      };
      const result = calculatePreview(cart);
      expect(result.tax_amount).toBe(Math.round(unitPrice * 10 / 110));
    }
  });

  it('handles large amounts correctly', () => {
    const cart: TabletCart = {
      ...emptyCart,
      items: [
        { id: 'l1', product_id: 'p1', name: 'Big Order', unit_price: 1000000, quantity: 10, modifiers: [] },
      ],
    };
    const result = calculatePreview(cart);
    expect(result.items_total).toBe(10000000);
    expect(result.tax_amount).toBe(Math.round(10000000 * 10 / 110));
  });

  it('modifier with zero price_adjustment does not change total', () => {
    const cart: TabletCart = {
      ...emptyCart,
      items: [
        {
          id: 'l1',
          product_id: 'p1',
          name: 'Americano',
          unit_price: 35000,
          quantity: 1,
          modifiers: [{ group_name: 'Temperature', option_label: 'Hot', price_adjustment: 0 }],
        },
      ],
    };
    const result = calculatePreview(cart);
    expect(result.items_total).toBe(35000);
  });
});
