// apps/pos/src/stores/__tests__/cartStore.table-order-type.test.ts
// Bug 2026-08-25 — une table pouvait rester attachée à un panier take-out /
// delivery (type par défaut = take_out) : la commande payée sortait « take
// away » avec un numéro de table, invisible dans le panneau (le chip table ne
// s'affiche qu'en dine-in). Invariant gravé ici : table ⇔ dine_in.
import { describe, it, expect, beforeEach } from 'vitest';
import { useCartStore } from '../cartStore';

function fullReset(orderType: 'dine_in' | 'take_out' | 'delivery' = 'take_out') {
  useCartStore.setState({
    cart: { items: [], order_type: orderType },
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

describe('cartStore — table ⇔ dine_in coupling', () => {
  beforeEach(() => fullReset());

  it('setTableNumber on a take-out cart switches the order type to dine_in', () => {
    useCartStore.getState().setTableNumber('T-05');
    const { cart } = useCartStore.getState();
    expect(cart.tableNumber).toBe('T-05');
    expect(cart.order_type).toBe('dine_in');
  });

  it('setTableNumber on a delivery cart switches the order type to dine_in', () => {
    fullReset('delivery');
    useCartStore.getState().setTableNumber('T-02');
    expect(useCartStore.getState().cart.order_type).toBe('dine_in');
  });

  it('clearing the table (null) does NOT touch the order type', () => {
    fullReset('dine_in');
    useCartStore.getState().setTableNumber('T-05');
    useCartStore.getState().setTableNumber(null);
    const { cart } = useCartStore.getState();
    expect(cart.tableNumber).toBeUndefined();
    expect(cart.order_type).toBe('dine_in');
  });

  it('switching to take_out drops the attached table', () => {
    fullReset('dine_in');
    useCartStore.getState().setTableNumber('T-05');
    useCartStore.getState().setOrderType('take_out');
    const { cart } = useCartStore.getState();
    expect(cart.order_type).toBe('take_out');
    expect(cart.tableNumber).toBeUndefined();
  });

  it('switching to delivery drops the attached table', () => {
    fullReset('dine_in');
    useCartStore.getState().setTableNumber('T-05');
    useCartStore.getState().setOrderType('delivery');
    expect(useCartStore.getState().cart.tableNumber).toBeUndefined();
  });

  it('staying on dine_in keeps the table', () => {
    fullReset('dine_in');
    useCartStore.getState().setTableNumber('T-05');
    useCartStore.getState().setOrderType('dine_in');
    expect(useCartStore.getState().cart.tableNumber).toBe('T-05');
  });
});
