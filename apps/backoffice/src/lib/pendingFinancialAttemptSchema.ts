import { PAYMENT_METHODS } from '@breakery/supabase';
import { validBankPayload, type BankManageSnapshot, type BankPostSnapshot, type BankFinalizeSnapshot } from './bankAttemptSchema.js';
import type { B2bPaymentMethod } from '@/features/btob/hooks/useRecordB2bPayment.js';

export interface RefundSnapshot {
  orderId: string;
  lines: { order_item_id: string; qty: number }[];
  tenders: { method: string; amount: number; reference?: string }[];
  reason: string;
}
export interface PaymentSnapshot {
  customerId: string;
  amount: number;
  method: B2bPaymentMethod;
  reference?: string;
  paidAt?: string;
  notes?: string;
  invoiceIds?: string[];
}
export interface LoyaltyConversionSnapshot { customerId: string; points: number }
export interface LoyaltyAdjustmentSnapshot { customerId: string; delta: number; reason: string }
export interface ExpenseCreationSnapshot {
  category_id: string; amount: number; vat_amount: number;
  payment_method: 'cash' | 'transfer' | 'card' | 'credit';
  description: string; expense_date: string; vendor_name?: string;
}
export type ExpenseReceiptSnapshot = {
  expenseId: string; expectedPath: string | null;
} & ({ kind: 'remove' } | {
  kind: 'attach'; mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
  size: number; sha256: string;
});
export interface FinancialPayloads {
  bank_manage: BankManageSnapshot;
  bank_post: BankPostSnapshot;
  bank_finalize: BankFinalizeSnapshot;
  expense_creation: ExpenseCreationSnapshot;
  expense_receipt: ExpenseReceiptSnapshot;
  refund: RefundSnapshot;
  payment: PaymentSnapshot;
  loyalty_conversion: LoyaltyConversionSnapshot;
  loyalty_adjustment: LoyaltyAdjustmentSnapshot;
}
export type FinancialOperation = keyof FinancialPayloads;
export interface FinancialScope { environment: string; profileId: string; operation: FinancialOperation; target: string }
export interface BaseSlot { version: 1; revision: string; operation: FinancialOperation; target: string }
export type FinancialSlot<K extends FinancialOperation = FinancialOperation> = BaseSlot & (
  | { status: 'resolved' }
  | { status: 'pending'; idempotencyKey: string; payload: FinancialPayloads[K] }
);

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every((key) => keys.includes(key));
export const identifier = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 10000;
export const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const positive = (v: unknown): v is number => finite(v) && v > 0;
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(v);
const method = (v: unknown) => PAYMENT_METHODS.some((entry) => entry === v);
const optionalText = (v: Record<string, unknown>, key: string) => v[key] === undefined || text(v[key]);

/** Liste fermée : jamais de PIN, de bearer, d'en-têtes ou de réponse serveur. */
export function validPayload(operation: FinancialOperation, target: string, value: unknown): boolean {
  if (operation === 'bank_manage' || operation === 'bank_post' || operation === 'bank_finalize') return validBankPayload(operation, target, value);
  if (!isRecord(value)) return false;
  if (operation === 'expense_creation') {
    return target === 'new' && exact(value, ['category_id','amount','vat_amount','payment_method','description','expense_date','vendor_name'])
      && uuid(value.category_id) && positive(value.amount) && finite(value.vat_amount)
      && value.vat_amount >= 0 && value.vat_amount <= value.amount
      && typeof value.payment_method === 'string' && ['cash','transfer','card','credit'].includes(value.payment_method)
      && text(value.description) && value.description.trim().length > 0 && value.description.length <= 250
      && typeof value.expense_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.expense_date)
      && (value.vendor_name === undefined || (text(value.vendor_name) && value.vendor_name.length <= 120));
  }
  if (operation === 'expense_receipt') {
    if (!uuid(value.expenseId) || value.expenseId !== target
      || !(value.expectedPath === null || text(value.expectedPath))) return false;
    if (value.kind === 'remove') return exact(value,['expenseId','expectedPath','kind']);
    return value.kind === 'attach' && exact(value,['expenseId','expectedPath','kind','mime','size','sha256'])
      && typeof value.mime === 'string' && ['image/jpeg','image/png','image/webp','application/pdf'].includes(value.mime)
      && finite(value.size) && Number.isInteger(value.size) && value.size >= 0 && value.size <= 5242880
      && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256);
  }
  if (operation === 'refund') {
    return exact(value, ['orderId', 'lines', 'tenders', 'reason']) && value.orderId === target
      && text(value.reason) && value.reason.trim().length >= 3
      && Array.isArray(value.lines) && value.lines.length > 0 && value.lines.length <= 1000
      && value.lines.every((line: unknown) => isRecord(line) && exact(line, ['order_item_id', 'qty'])
        && identifier(line.order_item_id) && positive(line.qty))
      && Array.isArray(value.tenders) && value.tenders.length <= 9
      && value.tenders.every((tender: unknown) => isRecord(tender) && exact(tender, ['method', 'amount', 'reference'])
        && method(tender.method) && positive(tender.amount) && optionalText(tender, 'reference'));
  }
  if (operation === 'loyalty_conversion') {
    return exact(value, ['customerId', 'points']) && value.customerId === target
      && finite(value.points) && Number.isInteger(value.points) && value.points > 0
      && value.points <= 2147483647 && value.points % 100 === 0;
  }
  if (operation === 'loyalty_adjustment') {
    return exact(value, ['customerId', 'delta', 'reason']) && value.customerId === target
      && finite(value.delta) && Number.isInteger(value.delta) && value.delta !== 0 && Math.abs(value.delta) <= 1000000
      && text(value.reason) && value.reason === value.reason.trim() && value.reason.length >= 5 && value.reason.length <= 500;
  }
  return operation === 'payment' && exact(value, ['customerId', 'amount', 'method', 'reference', 'paidAt', 'notes', 'invoiceIds'])
    && value.customerId === target && positive(value.amount) && method(value.method)
    && optionalText(value, 'reference') && optionalText(value, 'paidAt') && optionalText(value, 'notes')
    && (value.invoiceIds === undefined || (Array.isArray(value.invoiceIds)
      && value.invoiceIds.length <= 1000 && value.invoiceIds.every(identifier)));
}

export function validSlot(value: unknown, scope: FinancialScope): value is FinancialSlot {
  if (!isRecord(value) || value.version !== 1 || !uuid(value.revision)
    || value.operation !== scope.operation || value.target !== scope.target) return false;
  const keys = ['version', 'revision', 'operation', 'target', 'status'];
  if (value.status === 'resolved') return exact(value, keys);
  return value.status === 'pending' && exact(value, [...keys, 'idempotencyKey', 'payload'])
    && uuid(value.idempotencyKey) && validPayload(scope.operation, scope.target, value.payload);
}
