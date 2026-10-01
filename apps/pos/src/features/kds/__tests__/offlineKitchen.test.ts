import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveKitchenFired, readKitchenJournal, saveKitchenStatus, retireKitchenRoot, acknowledgeKitchenIntent } from '../offlineKitchenJournal';
import { mergeKitchenRows } from '../offlineKitchenReconciliation';
import { useKdsOfflineStore } from '../kdsOfflineStore';
import { replayKitchenJournal } from '../offlineKitchenReplay';
import { tryLocalItemStatus } from '../offlineItemStatus';
import type { OrderFiredPayload, OrderItemStatusPayload } from '@/features/lan/busTopics';
import { queryClient } from '@/lib/queryClient';
import { QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { useKdsBumpOrder } from '../hooks/useKdsBumpOrder';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), auth: {
  isAuthenticated: true, isLocked: false, user: { id: 'chef' }, sessionToken: 'session', permissions: ['kds.operate'],
} }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => mocks.auth } }));
vi.mock('@/features/lan/hubBusClient', () => ({ hubBus: { publish: vi.fn() } }));
vi.mock('@/features/audit/emitPosEvent', () => ({ emitPosEvent: vi.fn() }));
const fired: OrderFiredPayload = {
  client_uuid: 'root', order_number: 'L-1', order_type: 'dine_in', table_number: '1', notes: null,
  fired_at: '2026-09-30T00:00:00Z', items: [{ id: 'line', product_id: 'product', product_name: 'Coffee',
    quantity: 1, unit_price: 10, modifiers: [], dispatch_stations: ['kitchen', 'barista'] }],
};
const status: OrderItemStatusPayload = { item_id: 'line', order_id: 'root', kitchen_status: 'ready',
  at: '2026-09-30T00:01:00Z', order_number: 'L-1', order_type: 'dine_in', table_number: '1' };
const resolution = { order_id: 'cloud', order_number: '#1', order_status: 'pending_payment',
  items: [{ id: 'server-line', client_line_id: 'line', kitchen_status: 'pending', is_cancelled: false }] };

beforeEach(() => {
  vi.restoreAllMocks(); mocks.rpc.mockReset(); localStorage.clear();
  mocks.auth.user = { id: 'chef' }; mocks.auth.sessionToken = 'session'; mocks.auth.isLocked = false;
  useKdsOfflineStore.getState().clear();
  queryClient.clear();
});

describe('durable kitchen journal', () => {
  it('persists an intent before advancing the projection and restores after a crash', () => {
    useKdsOfflineStore.getState().addFired(fired);
    tryLocalItemStatus('line', 'ready');
    const saved = readKitchenJournal();
    expect(saved.intents[0]).toMatchObject({ actorId: 'chef', status: 'ready' });
    useKdsOfflineStore.getState().clear();
    Object.values(saved.fired).forEach(useKdsOfflineStore.getState().addFired);
    Object.values(saved.statuses).forEach(useKdsOfflineStore.getState().applyStatus);
    expect(useKdsOfflineStore.getState().rows.line?.kitchen_status).toBe('ready');
    expect(readKitchenJournal().intents).toHaveLength(1);
  });
  it('does not acknowledge a gesture when storage is full', () => {
    useKdsOfflineStore.getState().addFired(fired);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => tryLocalItemStatus('line', 'ready')).toThrow('quota');
    expect(useKdsOfflineStore.getState().rows.line?.kitchen_status).toBe('pending');
  });
  it('received LAN status is projection only and cannot regress', () => {
    saveKitchenFired(fired); saveKitchenStatus({ ...status, kitchen_status: 'served' }); saveKitchenStatus(status);
    expect(readKitchenJournal().intents).toEqual([]);
    expect(readKitchenJournal().statuses.line?.kitchen_status).toBe('served');
  });
  it('preserves append lines and rejects unreadable saved data', () => {
    saveKitchenFired(fired);
    saveKitchenFired({ ...fired, items: [{ ...fired.items[0]!, id: 'second' }] });
    expect(readKitchenJournal().fired.root?.items).toHaveLength(2);
    localStorage.setItem('breakery.kitchen-journal.v1', '{bad');
    expect(() => saveKitchenFired(fired)).toThrow();
    expect(localStorage.getItem('breakery.kitchen-journal.v1')).toBe('{bad');
  });
  it('retired lines cannot be resurrected by catchup but a new append survives', () => {
    saveKitchenFired(fired); saveKitchenStatus(status, 'chef');
    expect(retireKitchenRoot('root', ['line'])).toBe(false);
    acknowledgeKitchenIntent(readKitchenJournal().intents[0]!.id);
    expect(retireKitchenRoot('root', ['line'])).toBe(true);
    expect(saveKitchenFired(fired).items).toEqual([]);
    expect(readKitchenJournal().fired.root).toBeUndefined();
    expect(saveKitchenFired({ ...fired, items: [{ ...fired.items[0]!, id: 'append' }] }).items).toHaveLength(1);
  });
  it('retains a conflicting root durably and refuses to overwrite the first projection', () => {
    useKdsOfflineStore.getState().addFired(fired);
    useKdsOfflineStore.getState().addFired({ ...fired, client_uuid: 'other-root' });
    expect(useKdsOfflineStore.getState().rows.line?.order_id).toBe('root');
    expect(readKitchenJournal().fired['other-root']).toBeDefined();
    expect(useKdsOfflineStore.getState().issue).toContain('Conflicting');
  });
});

describe('kitchen replay authority and failures', () => {
  const queue = () => { saveKitchenFired(fired); saveKitchenStatus(status, 'chef'); };
  it('retains the same key after lost ACK then removes only after explicit server confirmation', async () => {
    queue();
    mocks.rpc.mockImplementation((name: string) => Promise.resolve(name.startsWith('resolve')
      ? { data: resolution, error: null } : { data: null, error: { message: 'timeout' } }));
    await replayKitchenJournal();
    const key = readKitchenJournal().intents[0]!.id;
    mocks.rpc.mockImplementation((name: string) => Promise.resolve({ data: name.startsWith('resolve') ? resolution : { outcome: 'applied' }, error: null }));
    await replayKitchenJournal();
    expect(mocks.rpc).toHaveBeenLastCalledWith('replay_kds_offline_status_v1', expect.objectContaining({ p_idempotency_key: key, p_actor_id: 'chef' }));
    expect(readKitchenJournal().intents).toEqual([]);
  });
  it('never replays for a different employee', async () => {
    queue(); mocks.auth.user = { id: 'waiter' };
    mocks.rpc.mockResolvedValue({ data: resolution, error: null }); await replayKitchenJournal();
    expect(mocks.rpc.mock.calls.every(([name]) => typeof name === 'string' && name.startsWith('resolve'))).toBe(true);
    expect(readKitchenJournal().intents).toHaveLength(1);
  });
  it('rechecks session identity after the mapping await', async () => {
    queue(); mocks.rpc.mockImplementation(() => { mocks.auth.sessionToken = 'replacement'; return Promise.resolve({ data: resolution, error: null }); });
    await replayKitchenJournal(); expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(readKitchenJournal().intents).toHaveLength(1);
  });
  it('keeps legacy unmatched lines and explicit wait responses', async () => {
    queue(); mocks.rpc.mockResolvedValue({ data: { ...resolution, items: [{ ...resolution.items[0]!, client_line_id: null }] }, error: null });
    await replayKitchenJournal(); expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(readKitchenJournal().intents).toHaveLength(1);
    expect(useKdsOfflineStore.getState().issue).toContain('cannot be matched');
  });
});

describe('canonical kitchen fusion', () => {
  it.each([false, true])('All ready includes other stations of the local order (mixed=%s)', async (mixed) => {
    useKdsOfflineStore.getState().addFired({ ...fired, items: [
      { ...fired.items[0]!, dispatch_stations: ['kitchen'] },
      { ...fired.items[0]!, id: 'bar-line', dispatch_stations: ['barista'] },
    ] });
    useKdsOfflineStore.getState().resolve('root', resolution);
    const rows = useKdsOfflineStore.getState().rows;
    const cloud = mixed ? [{ ...rows.line!, id: 'cloud-append', order_id: 'cloud' }] : [];
    const shown = mergeKitchenRows(cloud, rows, { root: resolution }, 'kitchen');
    expect(shown.some((row) => row.id === 'bar-line')).toBe(false);
    mocks.rpc.mockResolvedValue({ data: 3, error: null });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(() => useKdsBumpOrder(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ orderId: 'cloud', itemIds: shown.map((row) => row.id) });
    });
    expect(useKdsOfflineStore.getState().rows.line?.kitchen_status).toBe('ready');
    expect(useKdsOfflineStore.getState().rows['bar-line']?.kitchen_status).toBe('ready');
    expect(readKitchenJournal().intents.map((intent) => intent.itemId).sort()).toEqual(['bar-line', 'line']);
    if (mixed) expect(mocks.rpc).toHaveBeenCalledWith('kds_bump_order_v2', expect.objectContaining({ p_order_id: 'cloud' }));
    else expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('does not retire an append received while the resolver was awaiting the server', async () => {
    useKdsOfflineStore.getState().addFired(fired);
    queryClient.setQueryData(['kds', 'kitchen'], []);
    mocks.rpc.mockImplementation(() => {
      useKdsOfflineStore.getState().addFired({ ...fired, items: [{ ...fired.items[0]!, id: 'append' }] });
      return Promise.resolve({ data: { ...resolution, items: [{ ...resolution.items[0]!, kitchen_status: 'served' }] }, error: null });
    });
    await replayKitchenJournal();
    expect(readKitchenJournal().fired.root?.items.map((item) => item.id)).toEqual(['append']);
    expect(useKdsOfflineStore.getState().rows.append).toBeDefined();
    expect(readKitchenJournal().retired?.root).toEqual(['line']);
  });
  it('a canonical item remains journaled during a second outage after synchronization', () => {
    useKdsOfflineStore.getState().addFired(fired);
    useKdsOfflineStore.getState().resolve('root', resolution);
    const local = useKdsOfflineStore.getState().rows;
    const cloud = [{ ...local.line!, id: 'server-line', order_id: 'cloud' }];
    const shown = mergeKitchenRows(cloud, local, { root: resolution }, 'kitchen');
    expect(shown[0]?.id).toBe('server-line');
    expect(tryLocalItemStatus(shown[0]!.id, 'preparing')).toBe(true);
    expect(readKitchenJournal().intents[0]).toMatchObject({ rootId: 'root', itemId: 'line', status: 'preparing' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('canonical served and a newer cloud cancellation override stale active projections', () => {
    useKdsOfflineStore.getState().addFired(fired);
    const local = useKdsOfflineStore.getState().rows;
    const cloud = [{ ...local.line!, id: 'server-line', order_id: 'cloud' }];
    expect(mergeKitchenRows(cloud, local, { root: { ...resolution, items: [{ ...resolution.items[0]!, kitchen_status: 'served' }] } }, 'kitchen')).toEqual([]);
    useKdsOfflineStore.getState().applyStatus(status);
    expect(mergeKitchenRows([{ ...cloud[0]!, is_cancelled: true }], useKdsOfflineStore.getState().rows, { root: resolution }, 'kitchen')).toEqual([]);
  });
  it('groups a cloud append with the local line and All ready addresses the canonical order', async () => {
    useKdsOfflineStore.getState().addFired(fired);
    useKdsOfflineStore.getState().resolve('root', resolution);
    const local = useKdsOfflineStore.getState().rows;
    const cloud = [{ ...local.line!, id: 'cloud-append', order_id: 'cloud' }];
    const shown = mergeKitchenRows(cloud, local, { root: resolution }, 'kitchen');
    expect(new Set(shown.map((item) => item.group_order_id)).size).toBe(1);
    expect(shown.find((item) => item.id === 'line')?.order_id).toBe('root');
    expect(shown.find((item) => item.id === 'cloud-append')?.order_id).toBe('cloud');
    mocks.rpc.mockResolvedValue({ data: 2, error: null });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(() => useKdsBumpOrder(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ orderId: shown[0]!.group_order_id!, itemIds: shown.map((item) => item.id) }); });
    expect(mocks.rpc).toHaveBeenCalledWith('kds_bump_order_v2', expect.objectContaining({ p_order_id: 'cloud' }));
    expect(readKitchenJournal().intents[0]).toMatchObject({ itemId: 'line', status: 'ready' });
  });
  it('suppresses a cloud duplicate even when the local line was served and handles both stations', () => {
    useKdsOfflineStore.getState().addFired(fired);
    useKdsOfflineStore.getState().applyStatus({ ...status, kitchen_status: 'served' });
    const local = useKdsOfflineStore.getState().rows;
    const cloud = [{ ...local.line!, id: 'server-line', order_id: 'cloud', kitchen_status: 'pending' as const }];
    for (const station of ['kitchen', 'barista']) expect(mergeKitchenRows(cloud, local, { root: resolution }, station)).toEqual([]);
  });
  it('does not merge by product and gives cancellation priority', () => {
    useKdsOfflineStore.getState().addFired(fired);
    const local = useKdsOfflineStore.getState().rows;
    const cloud = [{ ...local.line!, id: 'different', order_id: 'other' }];
    expect(mergeKitchenRows(cloud, local, {}, 'kitchen')).toHaveLength(2);
    const cancelled = { ...resolution, items: [{ ...resolution.items[0]!, is_cancelled: true }] };
    expect(mergeKitchenRows([], local, { root: cancelled }, 'kitchen')).toEqual([]);
  });
});
