import { parseOrderFired, parseOrderItemStatus } from '@breakery/domain';
import type { HubEnvelope, HubTopic } from '../hub/envelope.js';
import type { LanDevice, LanPermission } from './deviceRegistry.js';
const publish: Partial<Record<HubTopic, LanPermission>> = {
  'order.fired': 'orders.publish',
  'order.item_status': 'kitchen.publish',
  'order.paid_offline': 'payments.publish',
};
const receive: Partial<Record<HubTopic, LanPermission>> = {
  'order.fired': 'orders.read',
  'order.item_status': 'kitchen.read',
  'order.paid_offline': 'payments.read',
};
export function mayReceive(device: LanDevice, topic: HubTopic): boolean {
  const permission = receive[topic];
  return permission !== undefined && device.permissions.includes(permission);
}
export function mayPublish(device: LanDevice, env: HubEnvelope): boolean {
  if (env.device_code !== device.code) return false;
  if (env.topic === 'presence.heartbeat') return true;
  const permission = publish[env.topic];
  if (!permission || !device.permissions.includes(permission)) return false;
  if (env.topic === 'order.fired') return parseOrderFired(env.payload) !== null;
  if (env.topic === 'order.item_status') return parseOrderItemStatus(env.payload) !== null;
  if (env.topic === 'order.paid_offline') {
    const p = env.payload as Record<string, unknown> | null;
    return (
      p !== null &&
      typeof p === 'object' &&
      ['order_id', 'order_number', 'idempotency_key', 'paid_at'].every(
        (k) => typeof p[k] === 'string' && p[k] !== '',
      ) &&
      ['amount', 'cash_received', 'change_given'].every(
        (k) => typeof p[k] === 'number' && Number.isFinite(p[k]) && p[k] >= 0,
      ) &&
      Number.isFinite(Date.parse(String(p.paid_at)))
    );
  }
  return false;
}
