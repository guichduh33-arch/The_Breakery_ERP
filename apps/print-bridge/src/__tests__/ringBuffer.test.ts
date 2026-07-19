import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HubRingBuffer } from '../hub/ringBuffer.js';
import { HUB_PROTOCOL_VERSION, type HubEnvelope } from '../hub/envelope.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-buf-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function env(i: number, topic: HubEnvelope['topic'] = 'order.fired'): HubEnvelope {
  return {
    v: HUB_PROTOCOL_VERSION,
    msg_id: `msg-${i}`,
    device_code: 'POS-1',
    ts: new Date(Date.UTC(2026, 6, 19, 10, 0, i)).toISOString(),
    topic,
    payload: { i },
  };
}

describe('HubRingBuffer', () => {
  it('appends and returns everything via since()', () => {
    const buf = new HubRingBuffer(path.join(dir, 'b.jsonl'));
    buf.append(env(1));
    buf.append(env(2));
    expect(buf.since().map((e) => e.msg_id)).toEqual(['msg-1', 'msg-2']);
    expect(buf.stats()).toEqual({ count: 2, oldest_ts: env(1).ts, newest_ts: env(2).ts });
  });

  it('since(ts) is strictly-newer', () => {
    const buf = new HubRingBuffer(path.join(dir, 'b.jsonl'));
    [1, 2, 3].forEach((i) => buf.append(env(i)));
    expect(buf.since(env(2).ts).map((e) => e.msg_id)).toEqual(['msg-3']);
  });

  it('caps memory at capacity', () => {
    const buf = new HubRingBuffer(path.join(dir, 'b.jsonl'), 3);
    [1, 2, 3, 4, 5].forEach((i) => buf.append(env(i)));
    expect(buf.since().map((e) => e.msg_id)).toEqual(['msg-3', 'msg-4', 'msg-5']);
  });

  it('reloads the last <capacity> entries from disk', () => {
    const file = path.join(dir, 'b.jsonl');
    const first = new HubRingBuffer(file, 3);
    [1, 2, 3, 4].forEach((i) => first.append(env(i)));
    const reloaded = new HubRingBuffer(file, 3);
    expect(reloaded.since().map((e) => e.msg_id)).toEqual(['msg-2', 'msg-3', 'msg-4']);
  });

  it('skips corrupt lines on reload (mid-write power cut)', () => {
    const file = path.join(dir, 'b.jsonl');
    fs.writeFileSync(file, `${JSON.stringify(env(1))}\n{"broken`, 'utf8');
    const buf = new HubRingBuffer(file);
    expect(buf.since().map((e) => e.msg_id)).toEqual(['msg-1']);
  });

  it('compacts the file once it exceeds 2x capacity', () => {
    const file = path.join(dir, 'b.jsonl');
    const buf = new HubRingBuffer(file, 2);
    [1, 2, 3, 4, 5].forEach((i) => buf.append(env(i)));
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l !== '');
    expect(lines.length).toBeLessThanOrEqual(4);
    expect(buf.since().map((e) => e.msg_id)).toEqual(['msg-4', 'msg-5']);
  });

  it('creates parent directories on first append', () => {
    const file = path.join(dir, 'nested', 'deep', 'b.jsonl');
    const buf = new HubRingBuffer(file);
    buf.append(env(1));
    expect(fs.existsSync(file)).toBe(true);
  });
});
