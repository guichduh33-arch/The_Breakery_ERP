import { describe, it, expect } from 'vitest';
import { parseEnvelope, parseHello, parseCatchup, HUB_PROTOCOL_VERSION } from '../hub/envelope.js';

const VALID = {
  v: HUB_PROTOCOL_VERSION,
  msg_id: 'a1b2c3',
  device_code: 'POS-FRONT-01',
  ts: '2026-07-19T10:00:00.000Z',
  topic: 'order.fired',
  payload: { order: 1 },
};

describe('parseEnvelope', () => {
  it('accepts a valid envelope', () => {
    expect(parseEnvelope(VALID)).toEqual(VALID);
  });
  it('accepts a null payload (the key must exist)', () => {
    expect(parseEnvelope({ ...VALID, payload: null })).not.toBeNull();
  });
  it.each([
    ['wrong version', { ...VALID, v: 2 }],
    ['missing msg_id', { ...VALID, msg_id: '' }],
    ['missing device_code', { ...VALID, device_code: '' }],
    ['bad ts', { ...VALID, ts: 'not-a-date' }],
    ['unknown topic', { ...VALID, topic: 'order.unknown' }],
    ['not an object', 'hello'],
    ['null', null],
  ])('rejects %s', (_label, input) => {
    expect(parseEnvelope(input)).toBeNull();
  });
  it('rejects a missing payload key', () => {
    const { payload: _p, ...rest } = VALID;
    expect(parseEnvelope(rest)).toBeNull();
  });
});

describe('parseHello', () => {
  it('accepts with and without token', () => {
    expect(parseHello({ type: 'hello', device_code: 'X', device_type: 'pos' }))
      .toEqual({ type: 'hello', device_code: 'X', device_type: 'pos' });
    expect(parseHello({ type: 'hello', device_code: 'X', device_type: 'pos', token: 't' }))
      .toEqual({ type: 'hello', device_code: 'X', device_type: 'pos', token: 't' });
  });
  it.each([
    ['empty device_code', { type: 'hello', device_code: '', device_type: 'pos' }],
    ['missing device_type', { type: 'hello', device_code: 'X' }],
    ['non-string token', { type: 'hello', device_code: 'X', device_type: 'pos', token: 42 }],
    ['wrong type', { type: 'catchup' }],
  ])('rejects %s', (_label, input) => {
    expect(parseHello(input)).toBeNull();
  });
});

describe('parseCatchup', () => {
  it('accepts with and without since_ts', () => {
    expect(parseCatchup({ type: 'catchup' })).toEqual({ type: 'catchup' });
    expect(parseCatchup({ type: 'catchup', since_ts: '2026-07-19T10:00:00Z' }))
      .toEqual({ type: 'catchup', since_ts: '2026-07-19T10:00:00Z' });
  });
  it('rejects a bad since_ts', () => {
    expect(parseCatchup({ type: 'catchup', since_ts: 'nope' })).toBeNull();
  });
});
