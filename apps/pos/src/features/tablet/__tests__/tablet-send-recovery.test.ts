import { beforeEach, describe, expect, it } from 'vitest';
import { useTabletCartStore } from '@/stores/tabletCartStore';

beforeEach(() => {
  useTabletCartStore.getState().clearCart();
  useTabletCartStore.setState({ tableNumber: '7', items: [
    { id: 'l1', product_id: 'p1', name: 'Coffee', quantity: 1, unit_price: 20000, modifiers: [] },
  ] });
});

describe('reprise d’un envoi tablette incertain', () => {
  it('conserve la clé, le serveur et le contenu après réhydratation', async () => {
    const first = useTabletCartStore.getState().beginSend('waiter-1', true);
    await useTabletCartStore.persist.rehydrate();
    const retry = useTabletCartStore.getState().beginSend('waiter-1', false);
    expect(retry).toEqual(first);
    expect(retry.online).toBe(true);
  });

  it('empêche de changer la table ou les articles d’une tentative incertaine', () => {
    const first = useTabletCartStore.getState().beginSend('waiter-1', true);
    useTabletCartStore.getState().updateQuantity('l1', 3);
    useTabletCartStore.getState().setTableNumber('8');
    useTabletCartStore.getState().setAppendTarget({ id: 'other', orderNumber: '42', tableNumber: '8' });
    expect(useTabletCartStore.getState().items).toEqual(first.cart.items);
    expect(useTabletCartStore.getState().tableNumber).toBe('7');
    expect(useTabletCartStore.getState().appendToOrderId).toBeNull();
    expect(() => useTabletCartStore.getState().beginSend('waiter-2', true)).toThrow('pending_order_other_waiter');
  });

  it('autorise la correction après refus explicite et utilise une nouvelle clé', () => {
    const first = useTabletCartStore.getState().beginSend('waiter-1', true);
    useTabletCartStore.getState().releaseSend();
    useTabletCartStore.getState().updateQuantity('l1', 2);
    const next = useTabletCartStore.getState().beginSend('waiter-1', true);
    expect(next.clientUuid).not.toBe(first.clientUuid);
    expect(next.cart.items[0]?.quantity).toBe(2);
  });
});
