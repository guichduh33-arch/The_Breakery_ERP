import { describe, it, expect } from 'vitest';
import { buildSubmitPayload } from '../buildSubmitPayload';
import type { TabletCart } from '../types';

const baseCart: TabletCart = {
  items: [],
  tableNumber: 'T-03',
  orderType: 'dine_in',
};

describe('buildSubmitPayload', () => {
  it('maps items to p_items with product_id, quantity, unit_price, modifiers', () => {
    const cart: TabletCart = {
      ...baseCart,
      items: [
        { id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 2, modifiers: [] },
        { id: 'l2', product_id: 'p2', name: 'Latte', unit_price: 40000, quantity: 1, modifiers: [] },
      ],
    };
    const payload = buildSubmitPayload(cart, 'waiter-uuid');
    expect(payload.p_items).toEqual([
      { product_id: 'p1', quantity: 2, unit_price: 35000, modifiers: [] },
      { product_id: 'p2', quantity: 1, unit_price: 40000, modifiers: [] },
    ]);
  });

  it('includes tableNumber and orderType at top level', () => {
    const payload = buildSubmitPayload({ ...baseCart, tableNumber: 'T-07', orderType: 'take_out' }, 'w1');
    expect(payload.p_table_number).toBe('T-07');
    expect(payload.p_order_type).toBe('take_out');
  });

  it('preserves modifier snapshot in p_items', () => {
    const cart: TabletCart = {
      ...baseCart,
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
    const payload = buildSubmitPayload(cart, 'waiter-uuid');
    expect(payload.p_items[0]?.modifiers).toEqual([
      { group_name: 'Temperature', option_label: 'Hot', price_adjustment: 0 },
      { group_name: 'Milk', option_label: 'Oat milk', price_adjustment: 5000 },
    ]);
  });

  it('returns empty p_items array when cart is empty', () => {
    const payload = buildSubmitPayload(baseCart, 'waiter-uuid');
    expect(payload.p_items).toEqual([]);
  });

  it('sets p_waiter_id from waiterId argument', () => {
    const payload = buildSubmitPayload(baseCart, 'waiter-abc-123');
    expect(payload.p_waiter_id).toBe('waiter-abc-123');
  });

  it('allows null tableNumber', () => {
    const payload = buildSubmitPayload({ ...baseCart, tableNumber: null }, 'w1');
    expect(payload.p_table_number).toBeNull();
  });

  it('does not include cart item id or name in p_items', () => {
    const cart: TabletCart = {
      ...baseCart,
      items: [{ id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] }],
    };
    const payload = buildSubmitPayload(cart, 'w1');
    const item = payload.p_items[0] as Record<string, unknown>;
    expect('id' in item).toBe(false);
    expect('name' in item).toBe(false);
  });

  // Session 59 (17 D1.1) — order-level note forwarded as p_notes.
  it('forwards a non-empty note as p_notes', () => {
    const payload = buildSubmitPayload({ ...baseCart, notes: 'No gluten — nut allergy' }, 'w1');
    expect(payload.p_notes).toBe('No gluten — nut allergy');
  });

  it('defaults p_notes to null when the cart has no notes field', () => {
    const payload = buildSubmitPayload(baseCart, 'w1');
    expect(payload.p_notes).toBeNull();
  });

  it('defaults p_notes to null when notes is explicitly null', () => {
    const payload = buildSubmitPayload({ ...baseCart, notes: null }, 'w1');
    expect(payload.p_notes).toBeNull();
  });

  // Audit lot 1 P0 n°6 (lot D, 2026-09-05) — un combo tapé sur la tablette
  // perdait ses `combo_components` en route vers `create_tablet_order_v9` :
  // `TabletSubmitPayload.p_items[]` ne porte pas encore la clé. Sans elle, le
  // serveur ne peut ni résoudre le prix serveur ni déduire le stock des
  // composants (P0 réel : create_tablet_order_v8 les valide mais ne les
  // écrit pas).
  it('forwards combo_components for a combo line', () => {
    const cart: TabletCart = {
      ...baseCart,
      items: [
        {
          id: 'l1',
          product_id: 'combo-1',
          name: 'Breakfast Set',
          unit_price: 40000,
          quantity: 1,
          modifiers: [{ group_name: 'Size', option_label: 'Large', price_adjustment: 8000 }],
          product_type: 'combo',
          combo_components: [
            {
              product_id: 'c1',
              quantity: 1,
              modifiers: [{ group_name: 'Temp', option_label: 'Iced', price_adjustment: 0 }],
            },
          ],
        },
      ],
    };
    const payload = buildSubmitPayload(cart, 'waiter-uuid');
    const item = payload.p_items[0] as Record<string, unknown>;
    expect(item.combo_components).toEqual([
      {
        product_id: 'c1',
        quantity: 1,
        modifiers: [{ group_name: 'Temp', option_label: 'Iced', price_adjustment: 0 }],
      },
    ]);
  });

  it('does not include combo_components for a non-combo line', () => {
    const cart: TabletCart = {
      ...baseCart,
      items: [{ id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] }],
    };
    const payload = buildSubmitPayload(cart, 'w1');
    const item = payload.p_items[0] as Record<string, unknown>;
    expect('combo_components' in item).toBe(false);
  });
});
