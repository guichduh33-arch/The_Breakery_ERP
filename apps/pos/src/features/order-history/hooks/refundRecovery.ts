import { PAYMENT_METHODS } from '@breakery/supabase';
import type { PaymentMethod } from '@breakery/domain';
import { createFinancialAttempts, type FinancialAttemptScope, type FinancialAttemptSlot } from '@breakery/utils';

export interface RefundSnapshot {
  orderId: string;
  lines: { order_item_id: string; qty: number }[];
  tenders: { method: PaymentMethod; amount: number; reference?: string }[];
  reason: string;
}
export type RefundScope = FinancialAttemptScope<'refund'>;
export type RefundSlot = FinancialAttemptSlot<RefundSnapshot, 'refund'>;
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const identifier = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;
export const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const positive = (v: unknown) => finite(v) && v > 0;
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every((key) => keys.includes(key));
const uuid = (v: unknown) => typeof v === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(v);
export function validRefundPayload(_operation: 'refund', target: string, v: unknown): boolean {
  return isRecord(v) && exact(v, ['orderId', 'lines', 'tenders', 'reason']) && v.orderId === target
    && typeof v.reason === 'string' && v.reason.length <= 10000 && v.reason.trim().length >= 3
    && Array.isArray(v.lines) && v.lines.length > 0 && v.lines.length <= 1000
    && v.lines.every((line: unknown) => isRecord(line) && exact(line, ['order_item_id', 'qty']) && identifier(line.order_item_id) && positive(line.qty))
    && Array.isArray(v.tenders) && v.tenders.length <= 9
    && v.tenders.every((tender: unknown) => isRecord(tender) && exact(tender, ['method', 'amount', 'reference'])
      && PAYMENT_METHODS.some((m) => m === tender.method) && positive(tender.amount)
      && (tender.reference === undefined || (typeof tender.reference === 'string' && tender.reference.length <= 10000)));
}
export function validRefundSlot(v: unknown, scope: RefundScope): v is RefundSlot {
  if (!isRecord(v) || v.version !== 1 || !uuid(v.revision) || v.operation !== 'refund' || v.target !== scope.target) return false;
  const keys = ['version', 'revision', 'operation', 'target', 'status'];
  return v.status === 'resolved' ? exact(v, keys) : v.status === 'pending' && exact(v, [...keys, 'payload', 'idempotencyKey'])
    && uuid(v.idempotencyKey) && validRefundPayload('refund', scope.target, v.payload);
}
export const { readFinancialSlot, pendingFinancialTargets, runFinancialAttempt } =
  createFinancialAttempts<{ refund: RefundSnapshot }>({ validPayload: validRefundPayload, validSlot: validRefundSlot });
