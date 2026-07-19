// Tests d'intégration du hub WS : vrai serveur HTTP sur port éphémère,
// vrais clients `ws` — couvre hello-auth, token, relai, catchup, presence.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createHub, type HubHandle } from '../hub/hubServer.js';
import { HubRingBuffer } from '../hub/ringBuffer.js';
import { HUB_PROTOCOL_VERSION, type HubEnvelope } from '../hub/envelope.js';

let dir: string;
let server: http.Server;
let hub: HubHandle;
let port: number;

function startHub(token: string | null = null): Promise<void> {
  hub = createHub({
    token,
    buffer: new HubRingBuffer(path.join(dir, 'buf.jsonl')),
    helloTimeoutMs: 200,
    pingIntervalMs: 60_000,
  });
  server = http.createServer();
  server.on('upgrade', hub.handleUpgrade);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-srv-')); });
afterEach(async () => {
  hub.close();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

function connect(): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}/ws`);
}

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    ws.once('message', (d) => resolve(JSON.parse((d as Buffer).toString('utf8')) as Record<string, unknown>));
    ws.once('close', (code) => reject(new Error(`closed_${code}`)));
    ws.once('error', reject);
  });
}

function nextClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.once('close', (code) => resolve(code)));
}

function open(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

async function authed(deviceCode: string, token?: string): Promise<WebSocket> {
  const ws = connect();
  await open(ws);
  const welcome = nextMessage(ws);
  ws.send(JSON.stringify({ type: 'hello', device_code: deviceCode, device_type: 'pos', token }));
  expect((await welcome).type).toBe('welcome');
  return ws;
}

function envelope(i: number, topic: HubEnvelope['topic'] = 'order.fired'): HubEnvelope {
  return {
    v: HUB_PROTOCOL_VERSION,
    msg_id: `m-${i}`,
    device_code: 'POS-1',
    ts: new Date(Date.UTC(2026, 6, 19, 10, 0, i)).toISOString(),
    topic,
    payload: { i },
  };
}

describe('hub hello-auth', () => {
  it('welcomes a valid hello and lists the device in presence', async () => {
    await startHub();
    const ws = await authed('POS-1');
    expect(hub.presence().map((p) => p.device_code)).toEqual(['POS-1']);
    ws.close();
  });

  it('closes 4001 when no hello arrives in time', async () => {
    await startHub();
    const ws = connect();
    await open(ws);
    expect(await nextClose(ws)).toBe(4001);
  });

  it('closes 4002 when the first message is not a hello', async () => {
    await startHub();
    const ws = connect();
    await open(ws);
    ws.send(JSON.stringify(envelope(1)));
    expect(await nextClose(ws)).toBe(4002);
  });

  it('closes 4003 on bad token, welcomes on good token', async () => {
    await startHub('secret');
    const bad = connect();
    await open(bad);
    bad.send(JSON.stringify({ type: 'hello', device_code: 'X', device_type: 'pos', token: 'wrong' }));
    expect(await nextClose(bad)).toBe(4003);

    const good = await authed('POS-1', 'secret');
    expect(hub.tokenRequired).toBe(true);
    good.close();
  });

  it('destroys upgrades on paths other than /ws', async () => {
    await startHub();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/other`);
    await new Promise<void>((resolve) => ws.once('error', () => resolve()));
  });
});

describe('hub relay + buffer + catchup', () => {
  it('relays an envelope to other authed clients, not the sender', async () => {
    await startHub();
    const a = await authed('POS-1');
    const b = await authed('KDS-1');
    const receivedByB = nextMessage(b);
    a.send(JSON.stringify(envelope(1)));
    expect((await receivedByB).msg_id).toBe('m-1');
    expect(hub.bufferStats().count).toBe(1);
    a.close(); b.close();
  });

  it('does not journal nor relay presence.heartbeat', async () => {
    await startHub();
    const a = await authed('POS-1');
    a.send(JSON.stringify(envelope(1, 'presence.heartbeat')));
    a.send(JSON.stringify(envelope(2)));
    // le 2e message force l'ordre : quand il est journalisé, le 1er est traité
    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (hub.bufferStats().count === 1) { resolve(); return; }
        setTimeout(check, 10);
      };
      check();
    });
    expect(hub.bufferStats().count).toBe(1);
    a.close();
  });

  it('answers catchup with strictly-newer envelopes', async () => {
    await startHub();
    const a = await authed('POS-1');
    a.send(JSON.stringify(envelope(1)));
    a.send(JSON.stringify(envelope(2)));
    const reply = nextMessage(a);
    a.send(JSON.stringify({ type: 'catchup', since_ts: envelope(1).ts }));
    const result = await reply;
    expect(result.type).toBe('catchup_result');
    expect((result.messages as HubEnvelope[]).map((m) => m.msg_id)).toEqual(['m-2']);
    a.close();
  });

  it('rejects an invalid envelope with an error message, connection stays open', async () => {
    await startHub();
    const a = await authed('POS-1');
    const reply = nextMessage(a);
    a.send(JSON.stringify({ v: 99, nope: true }));
    expect((await reply).code).toBe('invalid_envelope');
    expect(hub.presence()).toHaveLength(1);
    a.close();
  });

  it('removes a closed client from presence', async () => {
    await startHub();
    const a = await authed('POS-1');
    a.close();
    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (hub.presence().length === 0) { resolve(); return; }
        setTimeout(check, 10);
      };
      check();
    });
    expect(hub.presence()).toHaveLength(0);
  });
});
