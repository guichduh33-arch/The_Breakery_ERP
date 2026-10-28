import { bankDate } from '@/features/accounting/bank-reconciliation/dates.js';
import { decimalCents } from '@/features/accounting/bank-reconciliation/money.js';

export interface BankStatementRow { source_row: number; date: string; amount: string; description: string; reference?: string; balance: string | null }
export interface BankImportPayload {
  account_id: string; reconciliation_id?: string; period_start: string; period_end: string; currency: 'IDR';
  opening_balance: string | null; closing_balance: string | null; source_sha256: string;
  file_name: string; sheet_name: string; rows: BankStatementRow[]; duplicate_acknowledged: boolean;
}
export type BankManageSnapshot =
  | { kind: 'import'; statement: BankImportPayload }
  | { kind: 'match'; reconciliationId: string; bankIds: string[]; glIds: string[] }
  | { kind: 'unmatch'; reconciliationId: string; matchId: string; reason: string }
  | { kind: 'balances'; reconciliationId: string; opening: string | null; closing: string | null };
export interface BankPostSnapshot {
  reconciliationId: string; kind: 'settlement' | 'net_fee' | 'fee' | 'interest'; bankIds: string[];
  clearingIds: string[]; bankGlIds: string[]; counterAccountId: string | null; fee: string; date: string; description: string;
}
export interface BankFinalizeSnapshot { reconciliationId: string; transit: { gl_line_id: string; reason: string }[] }
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every((key) => allowed.includes(key));
export const bankUuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(v);
const text = (v: unknown, max: number, min = 1): v is string => typeof v === 'string' && v === v.trim() && v.length >= min && v.length <= max;
const date = (v: unknown): v is string => {
  try { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && bankDate(v, 'iso') === v; } catch { return false; }
};
const money = (v: unknown, nullable = false): boolean => {
  if (nullable && v === null) return true;
  try { return typeof v === 'string' && /^-?\d+\.\d{2}$/.test(v) && typeof decimalCents(v) === 'bigint'; } catch { return false; }
};
const ids = (v: unknown, minimum = 0, maximum = 1000): v is string[] => Array.isArray(v)
  && v.length >= minimum && v.length <= maximum && v.every(bankUuid) && new Set(v).size === v.length;

export function validBankImport(value: unknown): value is BankImportPayload {
  if (!object(value) || !keys(value, ['account_id','reconciliation_id','period_start','period_end','currency',
    'opening_balance','closing_balance','source_sha256','file_name','sheet_name','rows','duplicate_acknowledged'])
    || !bankUuid(value.account_id) || (value.reconciliation_id !== undefined && !bankUuid(value.reconciliation_id))
    || !date(value.period_start) || !date(value.period_end) || value.period_start > value.period_end
    || value.currency !== 'IDR' || !money(value.opening_balance, true) || !money(value.closing_balance, true)
    || typeof value.source_sha256 !== 'string' || !/^[a-f\d]{64}$/.test(value.source_sha256)
    || !text(value.file_name, 255) || !text(value.sheet_name, 120) || typeof value.duplicate_acknowledged !== 'boolean'
    || !Array.isArray(value.rows) || value.rows.length < 1 || value.rows.length > 5000) return false;
  const seen = new Set<number>();
  let previous = '';
  return value.rows.every((row: unknown) => {
    if (!object(row) || !keys(row,['source_row','date','amount','description','reference','balance'])
      || typeof row.source_row !== 'number' || !Number.isInteger(row.source_row) || row.source_row < 1 || row.source_row > 999999999
      || seen.has(row.source_row) || !date(row.date) || row.date < previous || row.date < (value.period_start as string) || row.date > (value.period_end as string)
      || !money(row.amount) || decimalCents(row.amount) === 0n || !money(row.balance, true)
      || !text(row.description,1000) || (row.reference !== undefined && !text(row.reference,255))) return false;
    seen.add(row.source_row); previous = row.date; return true;
  });
}

/** Schéma fermé : aucune place pour un PIN, JWT, header ou réponse serveur. */
export function validBankPayload(operation: string, target: string, value: unknown): boolean {
  if (!object(value)) return false;
  if (operation === 'bank_manage') {
    if (value.kind === 'import') return keys(value,['kind','statement']) && validBankImport(value.statement)
      && (value.statement.reconciliation_id ?? 'new') === target;
    if (!bankUuid(target) || value.reconciliationId !== target) return false;
    if (value.kind === 'match') return keys(value,['kind','reconciliationId','bankIds','glIds']) && ids(value.bankIds,1) && ids(value.glIds,1);
    if (value.kind === 'unmatch') return keys(value,['kind','reconciliationId','matchId','reason']) && bankUuid(value.matchId) && text(value.reason,1000,3);
    return value.kind === 'balances' && keys(value,['kind','reconciliationId','opening','closing']) && money(value.opening,true) && money(value.closing,true);
  }
  if (!bankUuid(target) || value.reconciliationId !== target) return false;
  if (operation === 'bank_post') return keys(value,['kind','reconciliationId','bankIds','clearingIds','bankGlIds','counterAccountId','fee','date','description'])
    && ['settlement','net_fee','fee','interest'].includes(String(value.kind)) && ids(value.bankIds,1) && ids(value.clearingIds) && ids(value.bankGlIds)
    && (value.counterAccountId === null || bankUuid(value.counterAccountId)) && money(value.fee) && decimalCents(value.fee) >= 0n
    && date(value.date) && text(value.description,1000,3);
  return operation === 'bank_finalize' && keys(value,['reconciliationId','transit']) && Array.isArray(value.transit)
    && value.transit.length <= 5000 && value.transit.every((v: unknown) => object(v) && keys(v,['gl_line_id','reason']) && bankUuid(v.gl_line_id) && text(v.reason,1000,3))
    && new Set(value.transit.map((v: { gl_line_id: string }) => v.gl_line_id)).size === value.transit.length;
}
