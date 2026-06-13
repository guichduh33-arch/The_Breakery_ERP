// apps/pos/src/stores/__tests__/cartStore.context-hygiene.test.ts
// S44 P1-A/B — cycle de vie pickedUpOrderId + purge du contexte client/table.
import { describe, it, expect, beforeEach } from 'vitest';
import type { Product } from '@breakery/domain';
import { useCartStore } from '../cartStore';

const makeProduct = (id: string, name: string, price = 25_000): Product => ({
  id,
  name,
  price,
  category_id: 'cat-1',
  modifier_groups: [],
} as unknown as Product);

function fullReset() {
  useCartStore.setState({
    cart: { items: [], order_type: 'dine_in' },
    lockedItemIds: [],
    printedItemIds: [],
    attachedCustomer: null,
    pickedUpOrderId: null,
    appliedPromotions: [],
    dismissedPromotionIds: new Set<string>(),
    isOffline: false,
  });
  sessionStorage.removeItem('breakery.cart.v2');
}

const CUSTOMER = { id: 'cust-A', name: 'A', lifetime_points: 0 } as never;

describe('cartStore context hygiene (S44)', () => {
  beforeEach(() => fullReset());

  it('P1-A: voidOrder clears pickedUpOrderId (no routing the next cart to the voided order)', () => {
    useCartStore.getState().setPickedUpOrderId('order-1');
    useCartStore.getState().voidOrder();
    expect(useCartStore.getState().pickedUpOrderId).toBeNull();
  });

  it('P1-B: clear() with no locked items purges customer + table + attachedCustomer', () => {
    const s = useCartStore.getState();
    s.attachCustomer(CUSTOMER);
    s.setTableNumber('T-05');
    s.clear();
    const after = useCartStore.getState();
    expect(after.cart.customerId).toBeUndefined();
    expect(after.cart.tableNumber).toBeUndefined();
    expect(after.attachedCustomer).toBeNull();
  });

  it('P1-B: clear() WITH locked items keeps the context (same in-flight fired order)', () => {
    const s = useCartStore.getState();
    s.add(makeProduct('p1', 'Latte'));
    const lineId = useCartStore.getState().cart.items[0]!.id;
    s.markLocked([lineId]);
    s.attachCustomer(CUSTOMER);
    s.setTableNumber('T-09');
    s.clear();
    const after = useCartStore.getState();
    // Context preserved (K3 — the fired order is still in flight).
    expect(after.cart.customerId).toBe(CUSTOMER.id);
    expect(after.cart.tableNumber).toBe('T-09');
    expect(after.attachedCustomer).not.toBeNull();
    // The locked line survives.
    expect(after.cart.items.map((i) => i.id)).toEqual([lineId]);
  });
});
