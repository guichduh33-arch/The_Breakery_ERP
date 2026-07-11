// S72 Lot 2 — POS audit outbox + emit. Runs on the localStorage backend
// (jsdom has no IndexedDB), which is exactly the durable fallback path.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the singleton supabase client and auth store BEFORE importing the SUT.
// vi.mock factories are hoisted, so shared refs must go through vi.hoisted.
const h = vi.hoisted(() => ({ rpc: vi.fn(), authed: true }));
const rpc = h.rpc;
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: h.rpc } }));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: {
    getState: () => ({
      user: { id: '00000000-0000-0000-0000-000000000001' },
      isAuthenticated: h.authed,
    }),
  },
}));

import { emitPosEvent, flushPosEvents } from '../emitPosEvent';
import { enqueueEvent, getPendingEvents, removeEvents, pendingCount } from '../outbox';
import type { PosEventEnvelope } from '../emitPosEvent';

function envelope(over: Partial<PosEventEnvelope> = {}): PosEventEnvelope {
  return {
    client_event_id: crypto.randomUUID(),
    event_type: 'order_opened',
    occurred_at: new Date().toISOString(),
    device_seq: 1,
    actor_id: null,
    payload: {},
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
  rpc.mockReset();
  h.authed = true;
});

describe('outbox (durable queue)', () => {
  it('enqueues and reads back pending records', async () => {
    await enqueueEvent(envelope({ event_type: 'item_added' }));
    expect(await pendingCount()).toBe(1);
    const pending = await getPendingEvents();
    expect(pending[0]!.event.event_type).toBe('item_added');
  });

  it('dedups on client_event_id (no duplicate)', async () => {
    const e = envelope();
    await enqueueEvent(e);
    await enqueueEvent(e); // replay
    expect(await pendingCount()).toBe(1);
  });

  it('orders pending by device_seq', async () => {
    await enqueueEvent(envelope({ device_seq: 5, reason: 'b' }));
    await enqueueEvent(envelope({ device_seq: 2, reason: 'a' }));
    const pending = await getPendingEvents();
    expect(pending.map((p) => p.event.reason)).toEqual(['a', 'b']);
  });

  it('removes acked records', async () => {
    const e = envelope();
    await enqueueEvent(e);
    await removeEvents([e.client_event_id]);
    expect(await pendingCount()).toBe(0);
  });
});

describe('emitPosEvent', () => {
  it('stamps an immutable envelope and queues it durably', async () => {
    emitPosEvent('cash_drawer_opened', { amount: 12, payload: { trigger: 'manual' } });
    await vi.waitFor(async () => expect(await pendingCount()).toBe(1));
    const [rec] = await getPendingEvents();
    expect(rec!.event.event_type).toBe('cash_drawer_opened');
    expect(rec!.event.amount).toBe(12);
    expect(rec!.event.actor_id).toBe('00000000-0000-0000-0000-000000000001');
    expect(rec!.event.payload).toEqual({ trigger: 'manual' });
    expect(typeof rec!.event.occurred_at).toBe('string');
  });

  it('never throws to the caller', () => {
    expect(() => emitPosEvent('login')).not.toThrow();
  });
});

describe('flushPosEvents', () => {
  it('ships pending events and drops them on server ack', async () => {
    rpc.mockResolvedValue({ data: { inserted: 1 }, error: null });
    await enqueueEvent(envelope({ event_type: 'session_opened' }));

    const acked = await flushPosEvents();

    expect(rpc).toHaveBeenCalledWith('record_pos_events_v1', expect.objectContaining({
      p_device_token: expect.any(String),
      p_events: expect.arrayContaining([expect.objectContaining({ event_type: 'session_opened' })]),
    }));
    expect(acked).toBe(1);
    expect(await pendingCount()).toBe(0);
  });

  it('keeps the queue intact on server error (no loss)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await enqueueEvent(envelope());
    const acked = await flushPosEvents();
    expect(acked).toBe(0);
    expect(await pendingCount()).toBe(1);
  });

  it('is a no-op when unauthenticated', async () => {
    h.authed = false;
    await enqueueEvent(envelope());
    const acked = await flushPosEvents();
    expect(acked).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
    expect(await pendingCount()).toBe(1);
  });
});
