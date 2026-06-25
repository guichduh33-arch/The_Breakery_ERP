import { describe, it, expect, beforeEach } from 'vitest';
import { useCartStore } from '@/stores/cartStore';
import type { ReopenOrderPayload } from '@/stores/cartStore';

const PAYLOAD: ReopenOrderPayload = {
  order_id: 'order-77',
  order_type: 'dine_in',
  customerId: null,
  tableNumber: '5',
  notes: null,
  items: [
    { id: 'oi-1', product_id: 'p1', name: 'Latte', unit_price: 30000, quantity: 1, modifiers: [], is_locked: true, kitchen_status: 'pending' },
    { id: 'oi-2', product_id: 'p2', name: 'Panini', unit_price: 45000, quantity: 2, modifiers: [], is_locked: false, kitchen_status: null },
  ],
};

beforeEach(() => {
  useCartStore.setState({
    cart: { items: [], order_type: 'take_out' },
    lockedItemIds: [], printedItemIds: [], attachedCustomer: null,
    pickedUpOrderId: null, appliedPromotions: [], dismissedPromotionIds: new Set(),
    isOffline: false,
  } as never);
});

describe('cartStore.reopenOrder', () => {
  it('loads items reusing order_items.id as the cart line id', () => {
    useCartStore.getState().reopenOrder(PAYLOAD);
    const ids = useCartStore.getState().cart.items.map((i) => i.id);
    expect(ids).toEqual(['oi-1', 'oi-2']);
    expect(useCartStore.getState().cart.tableNumber).toBe('5');
    expect(useCartStore.getState().cart.order_type).toBe('dine_in');
  });

  it('rehydrates locked items into BOTH lockedItemIds and printedItemIds', () => {
    useCartStore.getState().reopenOrder(PAYLOAD);
    expect(useCartStore.getState().lockedItemIds).toEqual(['oi-1']);
    expect(useCartStore.getState().printedItemIds).toEqual(['oi-1']);
  });

  it('sets pickedUpOrderId so the next fire appends to this order', () => {
    useCartStore.getState().reopenOrder(PAYLOAD);
    expect(useCartStore.getState().pickedUpOrderId).toBe('order-77');
  });

  it('locked items are not editable; unlocked items are', () => {
    useCartStore.getState().reopenOrder(PAYLOAD);
    expect(useCartStore.getState().canEdit('oi-1')).toBe(false);
    expect(useCartStore.getState().canEdit('oi-2')).toBe(true);
  });
});
