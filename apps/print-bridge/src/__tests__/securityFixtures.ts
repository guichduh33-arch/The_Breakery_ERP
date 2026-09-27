import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterAll } from 'vitest';
import { DeviceRegistry, LAN_PERMISSIONS } from '../security/deviceRegistry.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-security-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
export const TEST_SECRET = 'a'.repeat(64);
export function testRegistry() {
  const registry = new DeviceRegistry(path.join(root, crypto.randomUUID() + '.json'), 'test');
  registry.update({
    version: 1,
    generated_at: new Date().toISOString(),
    devices: ['POS-1', 'KDS-1', 'TABLET-1'].map((code) => ({
      id: code,
      code,
      device_type: code.startsWith('KDS') ? 'kds' : code.startsWith('TABLET') ? 'tablet' : 'pos',
      secret_hash: createHash('sha256').update(TEST_SECRET).digest('hex'),
      permissions: [...LAN_PERMISSIONS],
    })),
    printers: [
      { ip_address: '192.168.1.99', port: 9100 },
      { ip_address: '192.168.1.50', port: 9100 },
      { ip_address: '192.168.1.60', port: 9100 },
    ],
  });
  return registry;
}
