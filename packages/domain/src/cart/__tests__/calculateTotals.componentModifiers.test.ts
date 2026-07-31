// packages/domain/src/cart/__tests__/calculateTotals.componentModifiers.test.ts
//
// Bug (2026-07-31) — calculateTotals never read `combo_components[].modifiers`:
// the cart total carried the combo base price and the option surcharges (line
// modifiers) but NOT the ADR-017 component-modifier adjustments, while the
// server bills all three terms (_resolve_combo_price_v1). The payment amount
// posted from the cart therefore understated the server total on any combo
// with a priced component modifier.
//
// Contract pinned here — client mirror of the server price:
//   combo line = (unit_price [= base] + Σ line-modifier adj [= surcharges]
//                 + Σ component-modifier adj) × quantity
// Adjustments are summed per component ELEMENT, without multiplying by the
// component's own quantity — exactly like the server's price resolver (the
// stock resolver multiplies, the price resolver does not).
import { describe, it, expect } from 'vitest';
import { calculateTotals } from '../calculateTotals';
import type { Cart, CartItem } from '../../types/index.js';

const TAX_RATE = 0.10;

function comboLine(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 'l-combo',
    product_id: 'combo-1',
    name: 'Breakfast Combo',
    unit_price: 50000, // combo base price — the modal emits it alone
    quantity: 1,
    product_type: 'combo',
    modifiers: [
      { group_name: 'plate', option_label: 'Pain au chocolat', price_adjustment: 3000 },
      { group_name: 'drink', option_label: 'Capuccino', price_adjustment: 5000 },
    ],
    combo_components: [
      { product_id: 'p-painchoc', quantity: 1 },
      {
        product_id: 'p-capuccino',
        quantity: 1,
        modifiers: [
          { group_name: 'Temperature', option_label: 'ICED', price_adjustment: 0 },
          { group_name: 'Milk', option_label: 'Oat', price_adjustment: 10000 },
        ],
      },
    ],
    ...overrides,
  };
}

describe('calculateTotals — combo component-modifier adjustments (ADR-017)', () => {
  it('bills base + surcharges + component adjustments, like the server', () => {
    const cart: Cart = { items: [comboLine()], order_type: 'take_out' };
    const t = calculateTotals(cart, TAX_RATE);
    // 50000 + (3000 + 5000) + (0 + 10000) = 68000
    expect(t.subtotal).toBe(68000);
    expect(t.total).toBe(68000);
  });

  it('multiplies by the LINE quantity, not the component quantity', () => {
    const cart: Cart = { items: [comboLine({ quantity: 2 })], order_type: 'take_out' };
    expect(calculateTotals(cart, TAX_RATE).subtotal).toBe(136000);
  });

  it('a combo without component answers keeps its pre-ADR-017 total', () => {
    const cart: Cart = {
      items: [
        comboLine({
          combo_components: [
            { product_id: 'p-painchoc', quantity: 1 },
            { product_id: 'p-capuccino', quantity: 1 },
          ],
        }),
      ],
      order_type: 'take_out',
    };
    expect(calculateTotals(cart, TAX_RATE).subtotal).toBe(58000);
  });

  it('a non-combo line is untouched by the new term', () => {
    const cart: Cart = {
      items: [
        {
          id: 'l1',
          product_id: 'p1',
          name: 'Americano',
          unit_price: 35000,
          quantity: 1,
          modifiers: [{ group_name: 'Milk', option_label: 'Oat', price_adjustment: 10000 }],
        },
      ],
      order_type: 'take_out',
    };
    expect(calculateTotals(cart, TAX_RATE).subtotal).toBe(45000);
  });
});
