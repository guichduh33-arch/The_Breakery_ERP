import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { usePickedUpOrderSync } from '../usePickedUpOrderSync';
import { useCartStore } from '@/stores/cartStore';
import { usePaymentStore } from '@/stores/paymentStore';
import type { OrderSnapshot } from '@/stores/orderSnapshot';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), changed: (): void => undefined }));
vi.mock('../fetchOrderSnapshot', () => ({ fetchOrderSnapshot: mocks.fetch }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  channel: () => ({ on: (_event: unknown, _filter: unknown, cb: () => void) => {
    mocks.changed = cb;
    return { subscribe: () => ({}) };
  } }), removeChannel: vi.fn().mockResolvedValue(null),
} }));
const snapshot: OrderSnapshot = { order_id: 'a', order_number: 'P-42', order_type: 'dine_in', customerId: 'customer', tableNumber: '7', notes: null, items: [{ id: 'server', client_line_id: 'local', product_id: 'coffee', name: 'Coffee', unit_price: 20000, quantity: 2, line_total: 38000, discount_amount: 2000, modifiers: [], is_locked: true, kitchen_status: 'pending' }] };

beforeEach(() => {
  usePaymentStore.getState().reset();
  mocks.fetch.mockReset();
  useCartStore.setState({ cart: { items: [{ id: 'local', server_id: 'server', product_id: 'coffee', name: 'Coffee', unit_price: 20000, quantity: 1, modifiers: [] }], order_type: 'dine_in', customerId: 'customer', tableNumber: '7' }, pickedUpOrderId: 'a', orderOrigin: 'tablet', lockedItemIds: ['local'], printedItemIds: [] });
});

it('preserves an addition made while a refresh is in flight and applies remote edits/cancellations', async () => {
  let resolve!: (value: OrderSnapshot) => void;
  mocks.fetch.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  renderHook(() => usePickedUpOrderSync());
  act(() => { useCartStore.setState((s) => ({ cart: { ...s.cart, items: [...s.cart.items, { id: 'draft', product_id: 'bread', name: 'Bread', quantity: 1, unit_price: 10000, modifiers: [] }] } })); });
  await act(async () => { resolve(snapshot); await Promise.resolve(); });
  expect(useCartStore.getState().cart).toMatchObject({ customerId: 'customer', tableNumber: '7', items: [{ id: 'local', quantity: 2, discount: { amount: 2000 } }, { id: 'draft' }] });
  mocks.fetch.mockResolvedValueOnce({ ...snapshot, items: [{ ...snapshot.items[0], is_cancelled: true }] });
  act(() => mocks.changed());
  await waitFor(() => expect(useCartStore.getState().cart.items[0]?.is_cancelled).toBe(true));
  expect(useCartStore.getState().cart.items[1]?.id).toBe('draft');
});

it('ignores the previous order response after the cashier changes order', async () => {
  let resolve!: (value: OrderSnapshot) => void;
  mocks.fetch.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  renderHook(() => usePickedUpOrderSync());
  mocks.fetch.mockResolvedValue({ ...snapshot, order_id: 'b', order_number: 'P-43', items: [] });
  act(() => useCartStore.setState({ pickedUpOrderId: 'b', cart: { items: [], order_type: 'take_out' } }));
  await act(async () => { resolve(snapshot); await Promise.resolve(); });
  expect(useCartStore.getState().pickedUpOrderId).toBe('b');
  expect(useCartStore.getState().cart.items).toEqual([]);
});

it('does not overwrite a newer server acknowledgement with a refresh started earlier', async () => {
  let resolve!: (value: OrderSnapshot) => void;
  mocks.fetch.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  renderHook(() => usePickedUpOrderSync());
  const acknowledged = { ...snapshot, items: [{ ...snapshot.items[0]!, is_cancelled: true }] };
  act(() => useCartStore.getState().applyOrderSnapshot(acknowledged));
  mocks.fetch.mockResolvedValue(acknowledged);
  await act(async () => { resolve(snapshot); await Promise.resolve(); });
  expect(useCartStore.getState().cart.items[0]?.is_cancelled).toBe(true);
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});
