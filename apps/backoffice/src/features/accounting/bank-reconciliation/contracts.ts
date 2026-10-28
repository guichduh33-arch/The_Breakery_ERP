import { bankUuid } from '@/lib/bankAttemptSchema.js';
import { decimalCents, decimalText } from './money.js';
export interface BankAccount { id: string; code: string; name: string; account_class: number }
export interface BankCatalog { bank_accounts: BankAccount[]; clearing_accounts: BankAccount[]; counter_accounts: BankAccount[] }
export interface BankReconciliation {
  id: string; account_id: string; period_start: string; period_end: string; status: 'draft' | 'finalized';
  opening_balance: string | null; closing_balance: string | null; snapshot_sha256: string | null;
  account_name: string; account_code: string; row_count: number | null; matched_count: number | null;
}
export interface BankLine { id: string; ordinal: number; transaction_date: string; amount: string; description: string; reference: string; match_id: string | null }
export interface GlLine { id: string; entry_date: string; entry_number: string; amount: string; description: string; reference_type: string; match_id: string | null; account_code: string }
export interface BankMatch { id: string; bank_line_ids: string[]; gl_line_ids: string[]; amount: string; removed_at: string | null; removal_reason: string }
export interface BankDetail {
  reconciliation: BankReconciliation; bank_lines: BankLine[]; gl_lines: GlLine[]; matches: BankMatch[];
  imports: { id: string; file_name: string; source_sha256: string; sheet_name: string }[];
  entries: { id: string; kind: string; journal_entry_id: string; fee_amount: string }[];
  balances: { bank_opening: string | null; bank_closing: string | null; gl_opening: string; gl_closing: string; bank_total: string };
  source_integrity: { state: string; recorded_gl_closing: string | null; current_gl_closing: string | null } | null;
  next_bank_after: number | null; next_gl_after: string | null; match_history_truncated: boolean;
}
export interface BankSuggestion { bank_line_id: string; gl_line_id: string; bank_date: string; bank_amount: string; bank_description: string; entry_number: string; gl_description: string }
export const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid bank response. Refresh before continuing.');
  return value as Record<string, unknown>;
};
export const rows = (value: unknown): unknown[] => { if (!Array.isArray(value)) throw new Error('Invalid bank response list.'); return value; };
export const string = (value: unknown): string => { if (typeof value !== 'string') throw new Error('Invalid bank response text.'); return value; };
export const id = (value: unknown): string => { if (!bankUuid(value)) throw new Error('Invalid bank response identifier.'); return value; };
const optionalText = (value: unknown): string => value == null ? '' : string(value);
export const amount = (value: unknown): string => decimalText(decimalCents(value));
const nullableAmount = (value: unknown): string | null => value === null ? null : amount(value);
const cursor = (value: unknown): number | null => {
  if (value == null) return null;
  const result = Number(value); if (!Number.isSafeInteger(result) || result < 0) throw new Error('Invalid bank page cursor.'); return result;
};
export function parseReconciliation(value: unknown): BankReconciliation {
  const v = record(value);
  if (v.status !== 'draft' && v.status !== 'finalized') throw new Error('Invalid reconciliation status.');
  return { id: id(v.id), account_id: id(v.account_id), period_start: string(v.period_start), period_end: string(v.period_end), status: v.status,
    opening_balance: nullableAmount(v.opening_balance), closing_balance: nullableAmount(v.closing_balance), snapshot_sha256: v.snapshot_sha256 == null ? null : string(v.snapshot_sha256),
    account_name: optionalText(v.account_name), account_code: optionalText(v.account_code), row_count: cursor(v.row_count), matched_count: cursor(v.matched_count) };
}
export function parseCatalog(value: unknown): BankCatalog {
  const v = record(value);
  const accounts = (list: unknown): BankAccount[] => rows(list).map((entry) => {
    const a = record(entry); if (typeof a.account_class !== 'number') throw new Error('Invalid account class.');
    return { id: id(a.id), code: string(a.code), name: string(a.name), account_class: a.account_class };
  });
  return { bank_accounts: accounts(v.bank_accounts), clearing_accounts: accounts(v.clearing_accounts), counter_accounts: accounts(v.counter_accounts) };
}
export function parseGlLine(value: unknown, matches: BankMatch[] = []): GlLine {
  const v = record(value); const lineId = id(v.id);
  const lineAmount = v.amount == null ? decimalText(decimalCents(v.debit) - decimalCents(v.credit)) : amount(v.amount);
  return { id: lineId, entry_date: string(v.entry_date), entry_number: string(v.entry_number), amount: lineAmount,
    description: optionalText(v.description), reference_type: optionalText(v.reference_type), account_code: optionalText(v.account_code),
    match_id: v.match_id == null ? matches.find((m) => !m.removed_at && m.gl_line_ids.includes(lineId))?.id ?? null : id(v.match_id) };
}
export function parseDetail(value: unknown): BankDetail {
  const v = record(value); const balances = record(v.balances);
  const matches = rows(v.matches).map((entry): BankMatch => {
    const m = record(entry); return { id: id(m.id), bank_line_ids: rows(m.bank_line_ids).map(id), gl_line_ids: rows(m.gl_line_ids).map(id),
      amount: amount(m.amount), removed_at: m.removed_at == null ? null : string(m.removed_at), removal_reason: optionalText(m.removal_reason) };
  });
  const bank = rows(v.bank_lines).map((entry): BankLine => {
    const b = record(entry); const lineId = id(b.id); const ordinal = cursor(b.ordinal);
    if (ordinal === null) throw new Error('Missing bank row position.');
    return { id: lineId, ordinal, transaction_date: string(b.transaction_date), amount: amount(b.amount), description: string(b.description), reference: optionalText(b.reference),
      match_id: b.match_id == null ? matches.find((m) => !m.removed_at && m.bank_line_ids.includes(lineId))?.id ?? null : id(b.match_id) };
  });
  const integrity = v.source_integrity == null ? null : record(v.source_integrity);
  return { reconciliation: parseReconciliation(v.reconciliation), bank_lines: bank, gl_lines: rows(v.gl_lines).map((g) => parseGlLine(g,matches)), matches,
    imports: rows(v.imports).map((entry) => { const i = record(entry); return { id: id(i.id), file_name: string(i.file_name), source_sha256: string(i.source_sha256), sheet_name: string(i.sheet_name) }; }),
    entries: rows(v.entries).map((entry) => { const e = record(entry); return { id: id(e.id), kind: string(e.kind), journal_entry_id: id(e.journal_entry_id), fee_amount: amount(e.fee_amount) }; }),
    balances: { bank_opening: nullableAmount(balances.bank_opening), bank_closing: nullableAmount(balances.bank_closing), gl_opening: amount(balances.gl_opening), gl_closing: amount(balances.gl_closing), bank_total: amount(balances.bank_total) },
    source_integrity: integrity ? { state: string(integrity.state), recorded_gl_closing: integrity.recorded_gl_closing == null ? null : amount(integrity.recorded_gl_closing), current_gl_closing: integrity.current_gl_closing == null ? null : amount(integrity.current_gl_closing) } : null,
    next_bank_after: cursor(v.next_bank_after), next_gl_after: v.next_gl_after == null ? null : id(v.next_gl_after), match_history_truncated: v.match_history_truncated === true };
}
export function parseSuggestions(value: unknown): { items: BankSuggestion[]; next_after: number | null } {
  const v = record(value); return { items: rows(v.items).map((entry) => {
    const s = record(entry); return { bank_line_id: id(s.bank_line_id), gl_line_id: id(s.gl_line_id), bank_date: string(s.bank_date), bank_amount: amount(s.bank_amount), bank_description: string(s.bank_description), entry_number: string(s.entry_number), gl_description: optionalText(s.gl_description) };
  }), next_after: cursor(v.next_after) };
}
