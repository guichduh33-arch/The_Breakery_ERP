import type { Json } from '@breakery/supabase';
import { supabase } from '@/lib/supabase.js';
import { captureFinancialSession } from '@/lib/useFinancialAttempt.js';
import { FinancialAttemptError } from '@/lib/pendingFinancialAttempts.js';
import { bankUuid, type BankImportPayload, type BankManageSnapshot, type BankPostSnapshot, type BankFinalizeSnapshot } from '@/lib/bankAttemptSchema.js';
import { amount, id, parseCatalog, parseDetail, parseGlLine, parseReconciliation, parseSuggestions, record, rows } from './contracts.js';

type RpcReply = PromiseLike<{ data: unknown; error: { code: string; message: string } | null }>;
async function read<T>(request: RpcReply, parse: (data: unknown) => T): Promise<T> {
  const session = captureFinancialSession();
  const { data, error } = await request;
  if (!session.current()) throw new Error('Your session changed. Refresh this page.');
  if (error) throw new Error(error.message);
  return parse(data);
}
export const readBankCatalog = () => read(supabase.rpc('bank_reconciliation_catalog_v1'),parseCatalog);
export const readBankList = (account: string, before: string | null) => read(supabase.rpc('bank_reconciliation_list_v1', {
  ...(account ? { p_account_id: account } : {}), ...(before ? { p_before: before } : {}), p_limit: 50,
}), (data) => { const v = record(data); return { items: rows(v.items).map(parseReconciliation), next: v.next_before == null ? null : id(v.next_before) }; });
export const readBankDetail = (reconciliationId: string, bankAfter: number, glAfter: string | null) => read(supabase.rpc('bank_reconciliation_detail_v2', {
  p_reconciliation_id: reconciliationId, p_bank_after: bankAfter, ...(glAfter ? { p_gl_after: glAfter } : {}), p_limit: 100,
}),parseDetail);
export const readBankClearing = (reconciliationId: string, after: string | null) => read(supabase.rpc('bank_reconciliation_clearing_v2', {
  p_reconciliation_id: reconciliationId, ...(after ? { p_after: after } : {}), p_limit: 100,
}), (data) => { const v = record(data); return { items: rows(v.items).map((g) => parseGlLine(g)), next: v.next_after == null ? null : id(v.next_after) }; });
export const readBankSuggestions = (reconciliationId: string, after: number) => read(supabase.rpc('bank_reconciliation_suggestions_v1', {
  p_reconciliation_id: reconciliationId, p_after: after, p_limit: 100,
}),parseSuggestions);
export const previewBankImport = (statement: BankImportPayload) => read(supabase.rpc('bank_reconciliation_import_v2', {
  p_payload: statement as unknown as Json, p_idempotency_key: crypto.randomUUID(), p_confirm: false,
}), (data) => {
  const v = record(data); if (v.ok !== true) throw new Error('The statement could not be validated.');
  return { count: Number(v.row_count), total: v.total == null ? null : amount(v.total), warnings: rows(v.warnings ?? []), alreadyImported: v.already_imported === true,
    balanceCheck: v.balance_check === 'balanced' ? 'Balanced' : 'Unavailable' };
});

/** Seuls les refus transactionnels identifiés libèrent une PREMIÈRE tentative. */
export function definitiveBankFailure(code: string, message: string): boolean {
  if (code === 'PT401' || code === '42501') return true;
  if (code === 'P0002') return /^(reconciliation_not_found|match_not_found)$/.test(message);
  return code === '22023' && /^(invalid_|unique_|eligible_|explicit_|negative_|statement_|transaction_|running_|iso_|source_|potential_|import_|duplicate_|reconciliation_|bank_line_|gl_line_|clearing_line_|match_|reason_|unmatched_|transit_|every_|opening_|closing_|previous_|carried_|matched_|net_fee_|settlement_|clearing_lines_|manual_)/.test(message);
}
async function send(request: RpcReply, current: () => boolean, validate: (v: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
  const { data, error } = await request;
  if (!current()) throw new FinancialAttemptError('Your session changed. The saved attempt must be checked after signing in.');
  if (error) throw new FinancialAttemptError(error.message,definitiveBankFailure(error.code,error.message));
  const v = record(data);
  if (v.ok === false && v.error === 'invalid_pin') throw new FinancialAttemptError('Incorrect PIN. Please try again.',true);
  if (v.ok !== true || !validate(v)) throw new FinancialAttemptError('The response could not confirm this operation. Its original details remain saved.');
  return v;
}
const assertCurrent = (current: () => boolean) => { if (!current()) throw new FinancialAttemptError('Your session changed. Reopen this form.'); };
export async function sendBankManage(payload: BankManageSnapshot, key: string, current: () => boolean) {
  assertCurrent(current);
  const p_idempotency_key = key;
  switch (payload.kind) {
    case 'import': return send(supabase.rpc('bank_reconciliation_import_v2', { p_payload: payload.statement as unknown as Json, p_idempotency_key, p_confirm: true }),current,
      (v) => bankUuid(v.reconciliation_id) && bankUuid(v.import_id) && Number(v.row_count) === payload.statement.rows.length);
    case 'match': return send(supabase.rpc('bank_reconciliation_match_v2', { p_reconciliation_id: payload.reconciliationId, p_bank_line_ids: payload.bankIds, p_gl_line_ids: payload.glIds, p_idempotency_key }),current,(v) => bankUuid(v.match_id) && typeof amount(v.amount) === 'string');
    case 'unmatch': return send(supabase.rpc('bank_reconciliation_unmatch_v1', { p_match_id: payload.matchId, p_reason: payload.reason, p_idempotency_key }),current,(v) => v.match_id === payload.matchId && v.removed === true);
    case 'balances': return send(supabase.rpc('bank_reconciliation_balances_v2', {
      p_reconciliation_id: payload.reconciliationId, p_opening_balance: payload.opening === null ? null! : Number(payload.opening),
      p_closing_balance: payload.closing === null ? null! : Number(payload.closing), p_idempotency_key,
    }),current,(v) => v.reconciliation_id === payload.reconciliationId && (v.opening_balance === null ? null : amount(v.opening_balance)) === payload.opening && (v.closing_balance === null ? null : amount(v.closing_balance)) === payload.closing);
  }
}
export async function sendBankPost(payload: BankPostSnapshot, key: string, pin: string, current: () => boolean) {
  assertCurrent(current);
  return send(supabase.rpc('bank_reconciliation_post_v4', { p_reconciliation_id: payload.reconciliationId,
    p_kind: payload.kind, p_bank_line_ids: payload.bankIds, p_clearing_line_ids: payload.clearingIds, p_bank_gl_line_ids: payload.bankGlIds,
    p_counter_account_id: payload.counterAccountId ?? null!, p_fee_amount: Number(payload.fee), p_entry_date: payload.date,
    p_description: payload.description, p_manager_pin: pin, p_idempotency_key: key,
  }),current,(v) => bankUuid(v.entry_id) && bankUuid(v.je_id) && bankUuid(v.bank_gl_line_id) && bankUuid(v.match_id));
}
export async function sendBankFinalize(payload: BankFinalizeSnapshot, key: string, current: () => boolean) {
  assertCurrent(current);
  return send(supabase.rpc('bank_reconciliation_finalize_v3', { p_reconciliation_id: payload.reconciliationId,
    p_transit: payload.transit as unknown as Json, p_idempotency_key: key,
  }),current,(v) => v.reconciliation_id === payload.reconciliationId && v.status === 'finalized'
    && typeof v.snapshot_sha256 === 'string' && /^[a-f\d]{64}$/.test(v.snapshot_sha256));
}
