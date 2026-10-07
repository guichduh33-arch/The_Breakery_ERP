import fs from 'node:fs';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { PrinterTarget } from '@breakery/domain';

export const LAN_PERMISSIONS = [
  'orders.publish',
  'orders.read',
  'kitchen.publish',
  'kitchen.read',
  'receipts.print',
  'tickets.print',
  'drawer.open',
  'payments.publish',
  'payments.read',
  'cart.publish',
  'cart.read',
  'diagnostics',
] as const;
export type LanPermission = (typeof LAN_PERMISSIONS)[number];
export interface LanDevice {
  id: string;
  code: string;
  device_type: string;
  secret_hash: string;
  permissions: LanPermission[];
}
export interface LanRegistry {
  version: 1;
  generated_at: string;
  devices: LanDevice[];
  printers: (PrinterTarget & { code?: string })[];
}
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128;
export function parseRegistry(value: unknown): LanRegistry | null {
  if (
    !record(value) ||
    value.version !== 1 ||
    typeof value.generated_at !== 'string' ||
    !Number.isFinite(Date.parse(value.generated_at)) ||
    !Array.isArray(value.devices) ||
    value.devices.length > 1000 ||
    !Array.isArray(value.printers) ||
    value.printers.length > 1000
  )
    return null;
  if (
    !value.devices.every(
      (d) =>
        record(d) &&
        text(d.id) &&
        text(d.code) &&
        ['pos', 'tablet', 'kds'].includes(String(d.device_type)) &&
        typeof d.secret_hash === 'string' &&
        /^[0-9a-f]{64}$/.test(d.secret_hash) &&
        Array.isArray(d.permissions) &&
        d.permissions.length <= LAN_PERMISSIONS.length &&
        d.permissions.every((p) => (LAN_PERMISSIONS as readonly unknown[]).includes(p)),
    )
  )
    return null;
  if (
    !value.printers.every(
      (p) =>
        record(p) &&
        typeof p.ip_address === 'string' &&
        (p.code === undefined || text(p.code)) &&
        typeof p.port === 'number' &&
        Number.isInteger(p.port) &&
        p.port > 0 &&
        p.port <= 65535,
    )
  )
    return null;
  const registry = value as unknown as LanRegistry;
  if (
    new Set(registry.devices.map((d) => d.id)).size !== registry.devices.length ||
    new Set(registry.devices.map((d) => d.code)).size !== registry.devices.length
  )
    return null;
  return registry;
}
export function atomicJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temp, file);
}
export class DeviceRegistry {
  private registry: LanRegistry | null = null;
  constructor(
    readonly file: string,
    readonly source: string,
  ) {
    try {
      const cached: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (record(cached) && cached.source === source)
        this.registry = parseRegistry(cached.registry);
    } catch {
      /* Cache absent ou invalide : refus fermé. */
    }
  }
  update(value: unknown): void {
    const next = parseRegistry(value);
    if (!next) throw new Error('invalid_registry');
    // La mémoire ne bascule qu'après la persistance réussie.
    atomicJson(this.file, { source: this.source, registry: next });
    this.registry = next;
  }
  private blocked(): string[] | null {
    try {
      const v: unknown = JSON.parse(fs.readFileSync(this.file + '.blocked', 'utf8'));
      return Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : null;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === 'ENOENT' ? [] : null;
    }
  }
  authenticate(code: string, secret: string): LanDevice | null {
    if (!/^[0-9a-f]{64}$/.test(secret)) return null;
    return this.session(code, createHash('sha256').update(secret).digest('hex'));
  }
  session(code: string, hash: string): LanDevice | null {
    const device = this.registry?.devices.find((d) => d.code === code);
    const blocked = this.blocked();
    if (!device || blocked === null || blocked.includes(device.id) || !/^[0-9a-f]{64}$/.test(hash))
      return null;
    return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(device.secret_hash, 'hex'))
      ? device
      : null;
  }
  permitsPrinter(target: PrinterTarget): boolean {
    return (
      this.registry?.printers.some(
        (p) => p.ip_address === target.ip_address && p.port === target.port,
      ) ?? false
    );
  }
  printers(): (PrinterTarget & { code?: string })[] {
    return this.registry?.printers.map((printer) => ({ ...printer })) ?? [];
  }
}
