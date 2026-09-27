import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import { createApp } from '../app.js';
import { createHub, type HubHandle } from '../hub/hubServer.js';
import { HubRingBuffer } from '../hub/ringBuffer.js';
import { DeviceRegistry, atomicJson } from '../security/deviceRegistry.js';
import { loadConfig } from '../config.js';
let dir: string;
let server: https.Server;
let hub: HubHandle;
let registry: DeviceRegistry;
let port: number;
let ca: Buffer;
const secret = 'a'.repeat(64);
const digest = createHash('sha256').update(secret).digest('hex');
const devices = [
  {
    id: 'pos',
    code: 'POS',
    device_type: 'pos',
    secret_hash: digest,
    permissions: [
      'orders.publish',
      'orders.read',
      'kitchen.read',
      'receipts.print',
      'tickets.print',
      'drawer.open',
    ],
  },
  {
    id: 'tablet',
    code: 'TABLET',
    device_type: 'tablet',
    secret_hash: digest,
    permissions: ['orders.publish', 'orders.read', 'tickets.print'],
  },
  {
    id: 'kds',
    code: 'KDS',
    device_type: 'kds',
    secret_hash: digest,
    permissions: ['orders.read', 'kitchen.publish', 'kitchen.read'],
  },
];
const send = vi.fn().mockResolvedValue(undefined),
  kick = vi.fn().mockResolvedValue(undefined);
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-tls-'));
  const openssl =
    process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
  execFileSync(
    openssl,
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      path.join(dir, 'key.pem'),
      '-out',
      path.join(dir, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=IP:127.0.0.1,DNS:localhost',
    ],
    { stdio: 'ignore', windowsHide: true },
  );
  ca = fs.readFileSync(path.join(dir, 'cert.pem'));
  registry = new DeviceRegistry(path.join(dir, 'registry.json'), 'cloud');
  registry.update({
    version: 1,
    generated_at: new Date().toISOString(),
    devices,
    printers: [{ ip_address: '192.168.1.50', port: 9100 }],
  });
  hub = createHub({
    registry,
    allowedOrigins: ['https://shop.test'],
    buffer: new HubRingBuffer(path.join(dir, 'bus.jsonl')),
  });
  const app = createApp({
    registry,
    hub,
    send,
    kick,
    config: loadConfig({
      HUB_ALLOWED_ORIGINS: 'https://shop.test',
      RECEIPT_PRINTER_IP: '192.168.1.50',
    }),
  });
  server = https.createServer({ cert: ca, key: fs.readFileSync(path.join(dir, 'key.pem')) }, app);
  server.on('upgrade', hub.handleUpgrade);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
  send.mockClear();
  kick.mockClear();
});
afterEach(async () => {
  hub?.close();
  if (server) await new Promise<void>((r) => server.close(() => r()));
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});
const message = (ws: WebSocket) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    ws.once('message', (d) => {
      const bytes = Array.isArray(d) ? Buffer.concat(d) : Buffer.from(d as ArrayBuffer);
      resolve(JSON.parse(bytes.toString('utf8')) as Record<string, unknown>);
    });
    ws.once('error', reject);
  });
async function connect(code: string) {
  const ws = new WebSocket('wss://127.0.0.1:' + port + '/ws', { ca, origin: 'https://shop.test' });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  const welcome = message(ws);
  ws.send(
    JSON.stringify({ type: 'hello', device_code: code, device_type: 'forged', token: secret }),
  );
  expect((await welcome).type).toBe('welcome');
  return ws;
}
function post(code: string, route: string, body: unknown): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: '127.0.0.1',
        port,
        path: route,
        method: 'POST',
        ca,
        headers: {
          'content-type': 'application/json',
          'x-lan-device-code': code,
          'x-lan-secret': secret,
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}
it('routes a ticket and kitchen status over verified TLS, isolates the drawer, then revokes offline', async () => {
  const pos = await connect('POS'),
    tablet = await connect('TABLET'),
    kds = await connect('KDS');
  const fired = {
    v: 1,
    msg_id: 'fire',
    device_code: 'TABLET',
    ts: new Date().toISOString(),
    topic: 'order.fired',
    payload: {
      client_uuid: 'order',
      order_number: 'L-1',
      order_type: 'take_out',
      table_number: null,
      notes: null,
      fired_at: new Date().toISOString(),
      items: [
        {
          id: 'item',
          product_id: 'product',
          product_name: 'Bread',
          quantity: 1,
          unit_price: 10,
          modifiers: [],
          dispatch_stations: ['kitchen'],
        },
      ],
    },
  };
  const ticket = message(kds);
  const seenPos = message(pos);
  tablet.send(JSON.stringify(fired));
  expect((await ticket).topic).toBe('order.fired');
  await seenPos;
  const status = message(pos);
  kds.send(
    JSON.stringify({
      ...fired,
      msg_id: 'ready',
      device_code: 'KDS',
      topic: 'order.item_status',
      payload: {
        item_id: 'item',
        order_id: 'order',
        kitchen_status: 'ready',
        at: new Date().toISOString(),
        order_number: 'L-1',
        order_type: 'take_out',
        table_number: null,
      },
    }),
  );
  expect((await status).topic).toBe('order.item_status');
  expect(
    await post('TABLET', '/print/ticket', {
      printer: { ip_address: '192.168.1.50', port: 9100 },
      kind: 'prep',
      role: 'kitchen',
      order_number: 'L-1',
      items: [],
    }),
  ).toBe(200);
  expect(await post('TABLET', '/drawer/open', {})).toBe(403);
  expect(kick).not.toHaveBeenCalled();
  expect(await post('POS', '/drawer/open', {})).toBe(200);
  expect(kick).toHaveBeenCalledTimes(1);
  const closed = new Promise<number>((r) => tablet.once('close', r));
  atomicJson(registry.file + '.blocked', ['tablet']);
  expect(await closed).toBe(4003);
  expect(await post('TABLET', '/print/ticket', {})).toBe(401);
  const denied = message(pos);
  pos.send(JSON.stringify({ ...fired, device_code: 'KDS' }));
  expect((await denied).code).toBe('forbidden');
  pos.close();
  kds.close();
}, 30000);
