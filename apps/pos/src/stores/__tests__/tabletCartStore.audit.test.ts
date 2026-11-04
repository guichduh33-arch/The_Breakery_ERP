import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '@breakery/domain';
import { useTabletCartStore } from '../tabletCartStore';
import { emitPosEvent } from '@/features/audit/emitPosEvent';

vi.mock('@/features/audit/emitPosEvent', () => ({ emitPosEvent: vi.fn() }));
const product = { id: 'p1', name: 'Coffee', retail_price: 25000, product_type: 'finished' } as Product;

describe('tablet cart activity audit', () => {
  beforeEach(() => {
    useTabletCartStore.getState().clearCart();
    vi.mocked(emitPosEvent).mockClear();
  });
  it('records item additions, quantity and removal on the tablet', () => {
    useTabletCartStore.getState().addItem(product);
    const item = useTabletCartStore.getState().items[0]!;
    useTabletCartStore.getState().updateQuantity(item.id, 2);
    useTabletCartStore.getState().removeItem(item.id);
    expect(vi.mocked(emitPosEvent).mock.calls.map(([type]) => type))
      .toEqual(['order_opened', 'item_added', 'item_qty_changed', 'item_removed_pre_fire']);
    expect(emitPosEvent).toHaveBeenCalledWith('item_added', expect.objectContaining({
      payload: expect.objectContaining({ surface: 'tablet', name: 'Coffee' }),
    }));
  });
  it('records configured combo additions', () => {
    useTabletCartStore.getState().addCombo({ ...product, product_type: 'combo' }, [], [], 40000);
    expect(emitPosEvent).toHaveBeenCalledWith('item_added', expect.objectContaining({
      amount: 40000, payload: expect.objectContaining({ combo: true, surface: 'tablet' }),
    }));
  });
  it('records table, type, notes and append context', () => {
    const store = useTabletCartStore.getState();
    store.setTableNumber('T1');
    store.setOrderType('take_out');
    store.setNotes('No sugar');
    store.setAppendTarget({ id: 'order-1', orderNumber: 'T001', tableNumber: 'T1' });
    expect(vi.mocked(emitPosEvent).mock.calls.map(([type]) => type))
      .toEqual(['table_assigned', 'order_type_changed', 'note_added', 'order_resumed']);
    expect(emitPosEvent).toHaveBeenLastCalledWith('order_resumed', expect.objectContaining({
      order_id: 'order-1', order_number_snap: 'T001',
    }));
  });
  it('does not record no-ops or edits blocked by an in-flight send', () => {
    const store = useTabletCartStore.getState();
    store.setTableNumber(null);
    store.setOrderType('dine_in');
    store.setNotes(null);
    store.removeItem('missing');
    store.updateQuantity('missing', 2);
    store.beginSend('waiter', true);
    store.addItem(product);
    store.addCombo({ ...product, product_type: 'combo' }, [], [], 40000);
    store.setNotes('Blocked');
    store.setOrderType('take_out');
    store.setTableNumber('T1');
    store.setAppendTarget({ id: 'o1', orderNumber: 'T001', tableNumber: 'T1' });
    expect(emitPosEvent).not.toHaveBeenCalled();
  });
});
