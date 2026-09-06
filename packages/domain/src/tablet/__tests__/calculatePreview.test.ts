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

  it('total mirrors items_total in inclusive mode', () => {
    const cart: TabletCart = {
      ...emptyCart,
      items: [{ id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] }],
    };
    const result = calculatePreview(cart);
    expect(result.total).toBe(result.items_total);
  });

  it('exclusive mode (Lot 6b) adds the tax on top: tax = round_idr(items_total * r)', () => {
    const cart: TabletCart = {
      ...emptyCart,
      items: [{ id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] }],
    };
    const result = calculatePreview(cart, 0.10, false);
    expect(result.items_total).toBe(35000);
    expect(result.tax_amount).toBe(3500);
    expect(result.total).toBe(38500);
  });

  // Audit lot 1 P0 n°6 (lot D, 2026-09-05) — calculatePreview recompose
  // (unit_price + adjustment) × qty pour une ligne combo sans jamais lire les
  // ajustements de `combo_components[].modifiers`. Le composant Large d'un
  // combo peut porter son propre modificateur facturé (ADR-017,
  // _resolve_combo_price_v1 côté serveur) : l'aperçu tablette doit le
  // compter, sinon le total affiché à la serveuse ne colle pas au montant que
  // le serveur va réellement facturer.
  it('includes combo_components[].modifiers adjustments in items_total (ADR-017)', () => {
    const cart: TabletCart = {
      ...emptyCart,
      items: [
        {
          id: 'l1',
          product_id: 'combo-1',
          name: 'Breakfast Set',
          unit_price: 40000,
          quantity: 2,
          modifiers: [{ group_name: 'Size', option_label: 'Large', price_adjustment: 8000 }],
          product_type: 'combo',
          combo_components: [
            {
              product_id: 'c1',
              quantity: 1,
              modifiers: [{ group_name: 'Temp', option_label: 'Iced', price_adjustment: 2000 }],
            },
          ],
        },
      ],
    };
    const result = calculatePreview(cart);
    // (40000 + 8000 + 2000) × 2 = 100000 — ROUGE avant correction : 96000
    // (l'ajustement du composant, 2000, est ignoré).
    expect(result.items_total).toBe(100000);
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
