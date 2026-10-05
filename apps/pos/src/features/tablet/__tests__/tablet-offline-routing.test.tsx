import { createElement, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TabletCart } from '@breakery/domain';

const mocks = vi.hoisted(() => ({ map: vi.fn(), enqueue: vi.fn(), publish: vi.fn(), number: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));
vi.mock('@/features/lan/offlineMode', () => ({ isOfflineMode: () => true }));
vi.mock('@/features/cart/hooks/useStationMap', () => ({ getStationMap: mocks.map }));
vi.mock('@/features/lan/offlineOutbox', () => ({ enqueueIntent: mocks.enqueue, nextIntentSeq: () => 1 }));
vi.mock('@/features/lan/hubBusClient', () => ({ hubBus: { publish: mocks.publish } }));
vi.mock('@/features/lan/localOrderNumber', () => ({ nextLocalOrderNumber: mocks.number }));
import { useCreateTabletOrder } from '../hooks/useCreateTabletOrder';

const cart: TabletCart = {
  items: [{ id: 'line', product_id: 'p1', name: 'Coffee', quantity: 1, unit_price: 20000, modifiers: [] }],
  tableNumber: null, orderType: 'take_out', notes: null,
};
function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.enqueue.mockResolvedValue(undefined);
  mocks.publish.mockReturnValue(true);
  mocks.number.mockReturnValue('L-1');
});
describe('tablette hors ligne — routage connu avant enfilement', () => {
  it.each(['absent', 'incomplete', 'failed'] as const)('refuse une carte %s sans effet durable', async (kind) => {
    if (kind === 'failed') mocks.map.mockRejectedValue(new Error('network'));
    else mocks.map.mockResolvedValue(kind === 'absent' ? {} : { p1: [] });
    const input = kind === 'incomplete' ? { ...cart, items: [...cart.items, { ...cart.items[0]!, id: 'other', product_id: 'p2' }] } : cart;
    const { result } = renderHook(() => useCreateTabletOrder(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ cart: input, waiterId: 'waiter', clientUuid: 'uuid' })).rejects.toThrow('Kitchen routing');
    });
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.number).not.toHaveBeenCalled();
  });
  it.each([{ stations: [] }, { stations: ['kitchen'] }])('accepte un routage explicite %j', async ({ stations }) => {
    mocks.map.mockResolvedValue({ p1: stations });
    const { result } = renderHook(() => useCreateTabletOrder(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ cart, waiterId: 'waiter', clientUuid: 'uuid' }); });
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.publish).toHaveBeenCalledWith('order.fired', expect.objectContaining({
      items: [expect.objectContaining({ product_id: 'p1', dispatch_stations: stations })],
    }));
  });
});
