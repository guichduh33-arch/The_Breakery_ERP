// apps/pos/src/features/lan/__tests__/lanHub.dedup.test.ts
//
// Session 13 / Phase 5.A — LanHub dedup + self-echo + targeted-message tests.

import { describe, it, expect, vi } from 'vitest';
import { LanHub } from '../lanHub';
import { createMessage, type HeartbeatMessage } from '@breakery/domain';

function mockSupabase() {
  // Match the Supabase JS Realtime API surface we use.
  const channel = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
    send: vi.fn(),
  };
  return {
    channel: vi.fn().mockReturnValue(channel),
    removeChannel: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('LanHub', () => {
  it('dedupes same-id messages — receiver sees event exactly once', () => {
    const sb = mockSupabase();
    const onMessage = vi.fn();
    const hub = new LanHub({
      supabase: sb,
      hubDeviceId: 'hub-1',
      channelKeySuffix: 'aaa',
      broadcastChannel: null,
      onMessage,
    });

    const msg = createMessage<HeartbeatMessage>({
      from: 'peer-1',
      type: 'heartbeat',
      id: 'fixed-id',
      payload: { device_type: 'pos' },
    });

    hub.handle(msg);
    hub.handle(msg);
    hub.handle(msg);

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(hub.dedupStats().dropped).toBe(2);
  });

  it('treats distinct ids independently', () => {
    const sb = mockSupabase();
    const onMessage = vi.fn();
    const hub = new LanHub({
      supabase: sb,
      hubDeviceId: 'hub-1',
      channelKeySuffix: 'aaa',
      broadcastChannel: null,
      onMessage,
    });

    hub.handle(createMessage<HeartbeatMessage>({
      from: 'peer-1', type: 'heartbeat', id: 'a',
      payload: { device_type: 'pos' },
    }));
    hub.handle(createMessage<HeartbeatMessage>({
      from: 'peer-1', type: 'heartbeat', id: 'b',
      payload: { device_type: 'pos' },
    }));

    expect(onMessage).toHaveBeenCalledTimes(2);
  });

  it('drops messages originating from itself', () => {
    const sb = mockSupabase();
    const onMessage = vi.fn();
    const hub = new LanHub({
      supabase: sb,
      hubDeviceId: 'hub-1',
      channelKeySuffix: 'aaa',
      broadcastChannel: null,
      onMessage,
    });

    hub.handle(createMessage<HeartbeatMessage>({
      from: 'hub-1', // = our hubDeviceId
      type: 'heartbeat',
      payload: { device_type: 'pos' },
    }));

    expect(onMessage).not.toHaveBeenCalled();
  });

  it('rejects malformed envelopes via isLanMessage guard', () => {
    const sb = mockSupabase();
    const onMessage = vi.fn();
    const hub = new LanHub({
      supabase: sb,
      hubDeviceId: 'hub-1',
      channelKeySuffix: 'aaa',
      broadcastChannel: null,
      onMessage,
    });

    hub.handle({ not: 'a message' });
    hub.handle(null);
    hub.handle('a string');

    expect(onMessage).not.toHaveBeenCalled();
  });
});
