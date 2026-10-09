import { createElement, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TabletCart } from '@breakery/domain';

const mocks = vi.hoisted(() => ({ offline: vi.fn(), rpc: vi.fn(), enqueue: vi.fn(),
  pending: vi.fn(), print: vi.fn(), publish: vi.fn(), number: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('@/features/lan/offlineMode', () => ({ isOfflineMode: mocks.offline }));
vi.mock('@/features/cart/hooks/useStationMap', () => ({ getStationMap: () => Promise.resolve({ p1: ['kitchen'] }) }));
vi.mock('@/features/lan/offlineOutbox', () => ({ enqueueIntent: mocks.enqueue,
  getPendingIntents: mocks.pending, nextIntentSeq: () => 1 }));
vi.mock('@/features/lan/hubBusClient', () => ({ hubBus: { publish: mocks.publish } }));
vi.mock('@/features/lan/localOrderNumber', () => ({ nextLocalOrderNumber: mocks.number }));
vi.mock('../hooks/printTabletTickets', () => ({ printTabletTickets: mocks.print }));
import { useCreateTabletOrder } from '../hooks/useCreateTabletOrder';

const cart: TabletCart = { items: [{ id: 'line', product_id: 'p1', name: 'Coffee',
  quantity: 1, unit_price: 20000, modifiers: [] }], tableNumber: null, orderType: 'take_out', notes: null };
const input = { cart, waiterId: 'waiter', clientUuid: 'send-1' };
function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: new QueryClient() }, children);
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.offline.mockReturnValue(false);
  mocks.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: 'cloud-order', error: null }) });
  mocks.pending.mockResolvedValue([]);
  mocks.enqueue.mockResolvedValue(undefined);
  mocks.print.mockResolvedValue(true);
  mocks.publish.mockReturnValue(true);
  mocks.number.mockReturnValue('L-1');
});
describe('tablet order durability before paper', () => {
  it('does not print a rejected cloud order', async () => {
    mocks.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: null, error: { message: 'rejected' } }) });
    const { result } = renderHook(() => useCreateTabletOrder(), { wrapper });
    await act(async () => { await expect(result.current.mutateAsync(input)).rejects.toThrow('rejected'); });
    expect(mocks.print).not.toHaveBeenCalled();
  });
  it('preserves cloud success when paper fails and never creates another order', async () => {
    mocks.print.mockResolvedValue(false);
    const { result } = renderHook(() => useCreateTabletOrder(), { wrapper });
    await act(async () => {
      expect(await result.current.mutateAsync(input)).toMatchObject({ orderId: 'cloud-order', printingConfirmed: false });
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.print.mock.invocationCallOrder[0]!);
  });
  it('requires the offline write to complete before bus and paper', async () => {
    mocks.offline.mockReturnValue(true);
    mocks.enqueue.mockRejectedValue(new Error('disk full'));
    const { result } = renderHook(() => useCreateTabletOrder(), { wrapper });
    await act(async () => { await expect(result.current.mutateAsync(input)).rejects.toThrow('disk full'); });
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.print).not.toHaveBeenCalled();
  });
  it('recovers the durable local number without overwriting the intent', async () => {
    mocks.offline.mockReturnValue(true);
    mocks.pending.mockResolvedValue([{ kind: 'tablet_order', id: 'send-1', local_number: 'L-original' }]);
    const { result } = renderHook(() => useCreateTabletOrder(), { wrapper });
    await act(async () => { expect(await result.current.mutateAsync(input)).toMatchObject({ localNumber: 'L-original' }); });
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.number).not.toHaveBeenCalled();
    expect(mocks.print).toHaveBeenCalledWith(expect.anything(), cart, 'send-1', 'L-original', expect.any(String), false, true, expect.any(Function));
  });
});
