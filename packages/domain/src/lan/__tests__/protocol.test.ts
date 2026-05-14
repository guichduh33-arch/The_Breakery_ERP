// packages/domain/src/lan/__tests__/protocol.test.ts
// Session 13 / Phase 5.A — unit tests for the LAN protocol envelope.

import { describe, it, expect } from 'vitest';
import {
  isLanMessage,
  createMessage,
  type HeartbeatMessage,
  type PrintRequestMessage,
} from '../protocol.js';

describe('isLanMessage', () => {
  it('accepts a well-formed envelope', () => {
    const msg: HeartbeatMessage = {
      version: 1,
      id: 'abc',
      from: 'device-1',
      type: 'heartbeat',
      ts: Date.now(),
      payload: { device_type: 'pos' },
    };
    expect(isLanMessage(msg)).toBe(true);
  });

  it('rejects null / undefined / non-objects', () => {
    expect(isLanMessage(null)).toBe(false);
    expect(isLanMessage(undefined)).toBe(false);
    expect(isLanMessage('a string')).toBe(false);
    expect(isLanMessage(42)).toBe(false);
  });

  it('rejects wrong protocol version', () => {
    expect(
      isLanMessage({
        version: 2,
        id: 'x',
        from: 'd',
        type: 'heartbeat',
        ts: 1,
        payload: {},
      }),
    ).toBe(false);
  });

  it('rejects missing required fields', () => {
    const partial = {
      version: 1,
      from: 'd',
      type: 'heartbeat',
      ts: 1,
      payload: {},
    };
    expect(isLanMessage(partial)).toBe(false);
  });

  it('rejects empty string id / from', () => {
    expect(
      isLanMessage({
        version: 1,
        id: '',
        from: 'd',
        type: 'heartbeat',
        ts: 1,
        payload: {},
      }),
    ).toBe(false);
  });

  it('rejects non-numeric ts', () => {
    expect(
      isLanMessage({
        version: 1,
        id: 'a',
        from: 'd',
        type: 'heartbeat',
        ts: 'now',
        payload: {},
      }),
    ).toBe(false);
  });

  it('rejects NaN ts', () => {
    expect(
      isLanMessage({
        version: 1,
        id: 'a',
        from: 'd',
        type: 'heartbeat',
        ts: NaN,
        payload: {},
      }),
    ).toBe(false);
  });
});

describe('createMessage', () => {
  it('fills version, id, ts when omitted', () => {
    const msg = createMessage<HeartbeatMessage>({
      from: 'device-1',
      type: 'heartbeat',
      payload: { device_type: 'pos' },
    });

    expect(msg.version).toBe(1);
    expect(typeof msg.id).toBe('string');
    expect(msg.id.length).toBeGreaterThan(0);
    expect(typeof msg.ts).toBe('number');
    expect(isLanMessage(msg)).toBe(true);
  });

  it('preserves caller-provided id / ts', () => {
    const msg = createMessage<PrintRequestMessage>({
      from: 'device-1',
      type: 'print.request',
      id: 'fixed-id',
      ts: 42,
      payload: {
        ticket_type: 'kitchen_chit',
        reference_type: 'order',
        reference_id: 'order-1',
        data: { foo: 'bar' },
      },
    });
    expect(msg.id).toBe('fixed-id');
    expect(msg.ts).toBe(42);
  });

  it('produces a unique id per call when none provided', () => {
    const a = createMessage<HeartbeatMessage>({
      from: 'd',
      type: 'heartbeat',
      payload: { device_type: 'pos' },
    });
    const b = createMessage<HeartbeatMessage>({
      from: 'd',
      type: 'heartbeat',
      payload: { device_type: 'pos' },
    });
    expect(a.id).not.toBe(b.id);
  });
});
