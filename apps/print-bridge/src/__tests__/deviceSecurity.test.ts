import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { DeviceRegistry, atomicJson } from '../security/deviceRegistry.js';
import { mayPublish, mayReceive } from '../security/busPolicy.js';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
const dirs: string[] = [];
const secret = 'b'.repeat(64);
const id = '11111111-1111-4111-8111-111111111111';
const snapshot = (permissions: string[] = []) => ({
  version: 1,
  generated_at: new Date().toISOString(),
  devices: [
    {
      id,
      code: 'TABLET-1',
      device_type: 'tablet',
      secret_hash: createHash('sha256').update(secret).digest('hex'),
      permissions,
    },
  ],
  printers: [{ ip_address: '192.168.1.50', port: 9100 }],
});
function setup(permissions: string[] = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secure-hub-'));
  dirs.push(dir);
  const registry = new DeviceRegistry(path.join(dir, 'registry.json'), 'https://cloud.test');
  registry.update(snapshot(permissions));
  const send = vi.fn().mockResolvedValue(undefined);
  const kick = vi.fn().mockResolvedValue(undefined);
  const app = createApp({
    config: loadConfig({
      HUB_ALLOWED_ORIGINS: 'https://shop.test',
      RECEIPT_PRINTER_IP: '192.168.1.50',
    }),
    registry,
    send,
    kick,
  });
  return { registry, app, send, kick };
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
describe('device registry and protected HTTP', () => {
  it('rejects ESC/POS control injection through a kitchen ticket', async () => {
    const { app, send, kick } = setup(['tickets.print']);
    const res = await request(app)
      .post('/print/ticket')
      .set('x-lan-device-code', 'TABLET-1')
      .set('x-lan-secret', secret)
      .send({
        printer: { ip_address: '192.168.1.50', port: 9100 },
        order_number: 'L-1',
        role: 'kitchen',
        items: [{ name: '\u001bp\u0000', quantity: 1 }],
      });
    expect(res.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
    expect(kick).not.toHaveBeenCalled();
  });
  it('denies missing/wrong secret and an unprivileged tablet before touching the drawer', async () => {
    const { app, kick } = setup(['tickets.print']);
    expect((await request(app).post('/drawer/open')).status).toBe(401);
    expect(
      (
        await request(app)
          .post('/drawer/open')
          .set('x-lan-device-code', 'TABLET-1')
          .set('x-lan-secret', 'bad')
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post('/drawer/open')
          .set('x-lan-device-code', 'TABLET-1')
          .set('x-lan-secret', secret)
      ).status,
    ).toBe(403);
    expect(kick).not.toHaveBeenCalled();
  });
  it('permits the authorized drawer only with an allowed origin and printer', async () => {
    const { app, kick, registry } = setup(['drawer.open']);
    const post = () =>
      request(app)
        .post('/drawer/open')
        .set('x-lan-device-code', 'TABLET-1')
        .set('x-lan-secret', secret);
    expect((await post().set('Origin', 'https://evil.test')).status).toBe(403);
    expect(kick).not.toHaveBeenCalled();
    expect((await post().set('Origin', 'https://shop.test')).status).toBe(200);
    registry.update({ ...snapshot(['drawer.open']), printers: [] });
    expect(
      (await post().send({ printer: { ip_address: '192.168.1.50', port: 9100 } })).status,
    ).toBe(403);
    expect(kick).toHaveBeenCalledTimes(1);
  });
  it('does not bypass authentication using case or trailing slash', async () => {
    const { app, kick } = setup(['drawer.open']);
    for (const route of ['/drawer/open/', '/Drawer/Open'])
      expect((await request(app).post(route)).status).toBe(404);
    expect(kick).not.toHaveBeenCalled();
  });
  it('rejects a printer outside the registry', async () => {
    const { app, send } = setup(['tickets.print']);
    const res = await request(app)
      .post('/print/ticket')
      .set('x-lan-device-code', 'TABLET-1')
      .set('x-lan-secret', secret)
      .send({
        printer: { ip_address: '192.168.1.99', port: 9100 },
        order_number: 'L-1',
        items: [],
      });
    expect(res.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });
  it('keeps the last valid registry offline and after a restart', () => {
    const { registry } = setup(['tickets.print']);
    expect(() => registry.update({ version: 99 })).toThrow();
    const restarted = new DeviceRegistry(registry.file, registry.source);
    expect(restarted.authenticate('TABLET-1', secret)?.id).toBe(id);
    expect(
      new DeviceRegistry(registry.file, 'https://different.test').authenticate('TABLET-1', secret),
    ).toBeNull();
  });
  it('blocks locally, survives restart and cannot be unblocked by cloud sync', () => {
    const { registry } = setup(['tickets.print']);
    atomicJson(registry.file + '.blocked', [id]);
    expect(registry.authenticate('TABLET-1', secret)).toBeNull();
    registry.update(snapshot(['tickets.print']));
    expect(
      new DeviceRegistry(registry.file, registry.source).authenticate('TABLET-1', secret),
    ).toBeNull();
  });
  it('revokes immediately on the next registry refresh and fails closed on corrupt block data', () => {
    const { registry } = setup();
    registry.update({ ...snapshot(), devices: [] });
    expect(registry.authenticate('TABLET-1', secret)).toBeNull();
    registry.update(snapshot());
    fs.writeFileSync(registry.file + '.blocked', 'bad');
    expect(registry.authenticate('TABLET-1', secret)).toBeNull();
  });
  it('has no access without a valid registry', () => {
    const { registry } = setup();
    expect(
      new DeviceRegistry(registry.file + '.missing', registry.source).authenticate(
        'TABLET-1',
        secret,
      ),
    ).toBeNull();
  });
});
describe('bus capabilities', () => {
  it('rejects spoofed identity, wrong capabilities and malformed payloads', () => {
    const { registry } = setup(['orders.publish', 'orders.read']);
    const device = registry.authenticate('TABLET-1', secret)!;
    const env = {
      v: 1,
      msg_id: 'm',
      device_code: 'TABLET-1',
      ts: new Date().toISOString(),
      topic: 'order.item_status' as const,
      payload: {},
    };
    expect(mayPublish(device, env)).toBe(false);
    expect(mayPublish(device, { ...env, topic: 'order.fired' })).toBe(false);
    expect(mayPublish(device, { ...env, device_code: 'POS-1', topic: 'presence.heartbeat' })).toBe(
      false,
    );
    expect(mayReceive(device, 'order.fired')).toBe(true);
    expect(mayReceive(device, 'order.paid_offline')).toBe(false);
  });
});
