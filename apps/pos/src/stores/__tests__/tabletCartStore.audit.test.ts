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
    expect(vi.mocked(emitPosEvent).mock.calls.find(([type]) => type === 'item_added')?.[1])
      .toMatchObject({ payload: { surface: 'tablet', name: 'Coffee' } });
  });
  it('records configured combo additions', () => {
    useTabletCartStore.getState().addCombo({ ...product, product_type: 'combo' }, [], [], 40000);
    expect(vi.mocked(emitPosEvent).mock.calls.find(([type]) => type === 'item_added')?.[1])
      .toMatchObject({ amount: 40000, payload: { combo: true, surface: 'tablet' } });
  });
  it('records table, type, notes and append context', () => {
    const store = useTabletCartStore.getState();
    store.setTableNumber('T1');
    store.setOrderType('take_out');
    store.setNotes('No sugar');
    store.commitNotes();
    store.setAppendTarget({ id: 'order-1', orderNumber: 'T001', tableNumber: 'T1' });
    expect(vi.mocked(emitPosEvent).mock.calls.map(([type]) => type))
      .toEqual(['table_assigned', 'order_type_changed', 'note_added', 'order_resumed']);
    expect(emitPosEvent).toHaveBeenLastCalledWith('order_resumed', expect.objectContaining({
      order_id: 'order-1', order_number_snap: 'T001',
    }));
  });
  it('records a typed note once, when committed, not on every keystroke', () => {
    const store = useTabletCartStore.getState();
    for (const partial of ['W', 'Wa', 'Water', 'Watermelon']) store.setNotes(partial);
    expect(emitPosEvent).not.toHaveBeenCalled();
    useTabletCartStore.getState().commitNotes();
    useTabletCartStore.getState().commitNotes();
    const calls = vi.mocked(emitPosEvent).mock.calls;
    expect(calls.map(([type]) => type)).toEqual(['note_added']);
    expect(calls[0]?.[1]?.payload).toMatchObject({ notes: 'Watermelon', surface: 'tablet' });
  });
  it('journals an uncommitted note when the order is sent', () => {
    useTabletCartStore.getState().setNotes('No ice');
    useTabletCartStore.getState().beginSend('waiter', true);
    expect(vi.mocked(emitPosEvent).mock.calls.map(([type]) => type)).toEqual(['note_added']);
    expect(useTabletCartStore.getState().pendingSend?.cart.notes).toBe('No ice');
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
