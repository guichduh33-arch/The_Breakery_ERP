import { describe, expect, it } from 'vitest';
import { calculateTotals, lineTotalOf, type CartItem } from '@breakery/domain';
import { reconcileOrderItems, snapshotItem, type OrderItemSnapshot } from '../orderSnapshot';

const row: OrderItemSnapshot = {
  id: 'server', client_line_id: 'local', product_id: 'coffee', name: 'Coffee',
  unit_price: 20_000, quantity: 1, line_total: 18_000, discount_amount: 2_000,
  modifiers: [], is_locked: true, kitchen_status: 'pending',
};

describe('order snapshots', () => {
  it('raccorde les identités sans perdre les lignes locales', () => {
    const sent: CartItem = { id: 'local', product_id: 'coffee', name: 'Coffee', unit_price: 20_000, quantity: 1, modifiers: [] };
    const draft = { ...sent, id: 'draft', product_id: 'bread' };
    const result = reconcileOrderItems([sent, draft], [row]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'local', server_id: 'server', discount: { amount: 2_000 } });
    expect(result[1]).toBe(draft);
  });
  it('reflète quantité et annulation même sans nouvel identifiant', () => {
    const result = reconcileOrderItems([snapshotItem(row)], [{ ...row, quantity: 2, is_cancelled: true }]);
    expect(result[0]).toMatchObject({ id: 'local', quantity: 2, is_cancelled: true });
    expect(calculateTotals({ items: result, order_type: 'take_out' }, 0).total).toBe(0);
  });
  it('ne recompte pas les suppléments inclus dans le montant historique du combo', () => {
    const item = snapshotItem({ ...row, product_type: 'combo', unit_price: 50_000, line_total: 48_000,
      combo_components: [{ product_id: 'milk', quantity: 1, modifiers: [{ group_name: 'Milk', option_label: 'Oat', price_adjustment: 2_000 }] }],
    });
    expect(lineTotalOf(item)).toBe(50_000);
    expect(calculateTotals({ items: [item], order_type: 'take_out' }, 0).total).toBe(48_000);
  });
});
