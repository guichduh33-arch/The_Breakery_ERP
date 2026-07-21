// apps/pos/src/features/lan/__tests__/offlineReplay.test.ts
// Spec 006x lot 4 §4.3 — replay séquentiel vers les RPCs EXISTANTES avec les
// clés d'idempotence d'ORIGINE ; A4 : p_offline_replay=true sur le paiement ;
// premier échec = arrêt du drain (les intents restants attendent).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const rpcMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: rpcMock } }));

import { replayOfflineOutbox } from '../offlineReplay';
import { enqueueIntent, getPendingIntents } from '../offlineOutbox';
import { useAuthStore } from '@/stores/authStore';
import { useCartStore } from '@/stores/cartStore';

function seedAuth(): void {
  useAuthStore.setState({ isAuthenticated: true });
}

beforeEach(() => {
  localStorage.clear();
  rpcMock.mockReset();
  seedAuth();
  useCartStore.setState({ pickedUpOrderId: null, offlineOrder: null });
});

async function seedFireAndPay(): Promise<void> {
  await enqueueIntent({
    kind: 'fire', id: 'root-1', root_client_uuid: 'root-1', seq: 1,
    created_at: '2026-07-21T10:00:00.000Z', local_number: 'L-1',
    session_id: 'sess-1', order_type: 'take_out', table_number: null,
    items: [{ product_id: 'p1', quantity: 2, unit_price: 20000, modifiers: [] }],
  });
  await enqueueIntent({
    kind: 'cash_payment', id: 'idem-1', root_client_uuid: 'root-1', seq: 2,
    created_at: '2026-07-21T10:01:00.000Z', local_number: 'L-1',
    payment: { method: 'cash', amount: 40000, cash_received: 50000, change_given: 10000 },
  });
}

describe('replayOfflineOutbox', () => {
  it('replays fire then payment with the ORIGINAL keys, A4 flag on payment', async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === 'fire_counter_order_v4') {
        return Promise.resolve({ data: { order_id: 'db-1', order_number: '#0042', idempotent_replay: false }, error: null });
      }
      return Promise.resolve({ data: { order_id: 'db-1' }, error: null });
    });

    await seedFireAndPay();
    const res = await replayOfflineOutbox();

    expect(res).toEqual({ replayed: 2, failed: 0 });
    expect(rpcMock).toHaveBeenCalledTimes(2);
    const [fireCall, payCall] = rpcMock.mock.calls;
    expect(fireCall![0]).toBe('fire_counter_order_v4');
    expect(fireCall![1]).toMatchObject({ p_client_uuid: 'root-1', p_session_id: 'sess-1', p_order_type: 'take_out' });
    expect(payCall![0]).toBe('pay_existing_order_v13');
    expect(payCall![1]).toMatchObject({
      p_order_id: 'db-1',
      p_idempotency_key: 'idem-1',
      p_offline_replay: true,
      p_payment: { method: 'cash', amount: 40000, cash_received: 50000, change_given: 10000 },
    });
    expect(await getPendingIntents()).toEqual([]);
  });

  it('reconnects the ACTIVE cart to the replayed cloud order (pickedUpOrderId)', async () => {
    rpcMock.mockResolvedValue({ data: { order_id: 'db-1', order_number: '#0042', idempotent_replay: false }, error: null });
    useCartStore.setState({ offlineOrder: { clientUuid: 'root-1', localNumber: 'L-1' } });

    await enqueueIntent({
      kind: 'fire', id: 'root-1', root_client_uuid: 'root-1', seq: 1,
      created_at: '2026-07-21T10:00:00.000Z', local_number: 'L-1',
      session_id: 'sess-1', order_type: 'take_out', table_number: null,
      items: [{ product_id: 'p1', quantity: 1, unit_price: 20000, modifiers: [] }],
    });
    await replayOfflineOutbox();

    expect(useCartStore.getState().pickedUpOrderId).toBe('db-1');
    expect(useCartStore.getState().offlineOrder).toBeNull();
  });

  it('resolves an orphan payment (fire replayed in a previous run) via the idempotent fire lookup', async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === 'fire_counter_order_v4') {
        return Promise.resolve({ data: { order_id: 'db-7', order_number: '#0007', idempotent_replay: true }, error: null });
      }
      return Promise.resolve({ data: {}, error: null });
    });

    await enqueueIntent({
      kind: 'cash_payment', id: 'idem-7', root_client_uuid: 'root-7', seq: 5,
      created_at: '2026-07-21T11:00:00.000Z', local_number: 'L-7',
      payment: { method: 'cash', amount: 10000, cash_received: 10000, change_given: 0 },
    });
    const res = await replayOfflineOutbox();

    expect(res.replayed).toBe(1);
    expect(rpcMock.mock.calls[0]![0]).toBe('fire_counter_order_v4');
    expect(rpcMock.mock.calls[0]![1]).toMatchObject({ p_client_uuid: 'root-7' });
    expect(rpcMock.mock.calls[1]![1]).toMatchObject({ p_order_id: 'db-7', p_idempotency_key: 'idem-7' });
  });

  it('stops the drain on first failure — remaining intents stay queued', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } });

    await seedFireAndPay();
    const res = await replayOfflineOutbox();

    expect(res.replayed).toBe(0);
    expect(res.failed).toBe(2);
    expect(res.error).toBe('boom');
    expect((await getPendingIntents()).length).toBe(2);
  });

  it('replays an offline APPEND against the root order (p_order_id)', async () => {
    rpcMock.mockResolvedValue({ data: { order_id: 'db-1', order_number: '#0042', idempotent_replay: false }, error: null });

    await enqueueIntent({
      kind: 'fire', id: 'root-1', root_client_uuid: 'root-1', seq: 1,
      created_at: '2026-07-21T10:00:00.000Z', local_number: 'L-1',
      session_id: 'sess-1', order_type: 'dine_in', table_number: 'T1',
      items: [{ product_id: 'p1', quantity: 1, unit_price: 20000, modifiers: [] }],
    });
    await enqueueIntent({
      kind: 'fire', id: 'append-1', root_client_uuid: 'root-1', seq: 2,
      created_at: '2026-07-21T10:05:00.000Z', local_number: 'L-1',
      session_id: 'sess-1', order_type: 'dine_in', table_number: 'T1',
      items: [{ product_id: 'p2', quantity: 1, unit_price: 15000, modifiers: [] }],
    });
    await replayOfflineOutbox();

    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(rpcMock.mock.calls[1]![1]).toMatchObject({ p_client_uuid: 'append-1', p_order_id: 'db-1' });
  });

  it('no-ops when unauthenticated (intents wait for the next trigger)', async () => {
    useAuthStore.setState({ isAuthenticated: false });
    await seedFireAndPay();
    const res = await replayOfflineOutbox();
    expect(res).toEqual({ replayed: 0, failed: 0 });
    expect(rpcMock).not.toHaveBeenCalled();
    expect((await getPendingIntents()).length).toBe(2);
  });

  it('replays a tablet order with the original client_uuid', async () => {
    rpcMock.mockResolvedValue({ data: 'tab-order-1', error: null });

    await enqueueIntent({
      kind: 'tablet_order', id: 'tab-uuid-1', seq: 1,
      created_at: '2026-07-21T12:00:00.000Z', local_number: 'L-3',
      waiter_id: 'w-1', table_number: 'T4', order_type: 'dine_in', notes: 'no gluten',
      items: [{ product_id: 'p1', quantity: 1, unit_price: 20000, modifiers: [] }],
    });
    const res = await replayOfflineOutbox();

    expect(res.replayed).toBe(1);
    expect(rpcMock.mock.calls[0]![0]).toBe('create_tablet_order_v4');
    expect(rpcMock.mock.calls[0]![1]).toMatchObject({
      p_client_uuid: 'tab-uuid-1', p_waiter_id: 'w-1', p_table_number: 'T4', p_notes: 'no gluten',
    });
  });
});
