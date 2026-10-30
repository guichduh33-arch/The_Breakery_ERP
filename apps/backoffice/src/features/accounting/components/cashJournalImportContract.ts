import type { Json } from '@breakery/supabase';

export interface ImportLine {
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
}
export interface CashImportPreview {
  preview_hash: string;
  ready: number;
  already_imported: number;
  total_debit: number;
  total_credit: number;
  account_impacts: (ImportLine & { change: number })[];
  rows: {
    source_key: string; date: string; description: string; state: string;
    total?: number; corrects_je_id?: string; lines?: ImportLine[];
  }[];
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid import object.');
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid import text.');
  return value;
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid import amount.');
  return value;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Invalid import rows.');
  return value;
}
function line(value: unknown): ImportLine {
  const v = object(value);
  return { account_code: string(v.account_code), account_name: string(v.account_name), debit: number(v.debit), credit: number(v.credit) };
}
// Le SQL valide les lignes et les comptes ; le client limite l'enveloppe à la frontière fichier.
export function parseCashImportFile(text: string): { payload: Json; sourceName: string } {
  const parsed: unknown = JSON.parse(text);
  const v = object(parsed);
  if (v.version !== 1 || !/^[a-f0-9]{64}$/.test(string(v.source_sha256))
    || array(v.entries).length < 1 || array(v.entries).length > 200) throw new Error('Invalid journal package.');
  return { payload: parsed as Json, sourceName: string(v.source_name) };
}
export function parseCashImportPreview(value: unknown): CashImportPreview {
  const v = object(value);
  return {
    preview_hash: string(v.preview_hash), ready: number(v.ready), already_imported: number(v.already_imported),
    total_debit: number(v.total_debit), total_credit: number(v.total_credit),
    account_impacts: array(v.account_impacts).map((a) => ({ ...line(a), change: number(object(a).change) })),
    rows: array(v.rows).map((item) => {
      const r = object(item);
      return {
        source_key: string(r.source_key), date: string(r.date), description: string(r.description), state: string(r.state),
        ...(r.total !== undefined ? { total: number(r.total) } : {}),
        ...(r.corrects_je_id ? { corrects_je_id: string(r.corrects_je_id) } : {}),
        ...(r.lines !== undefined ? { lines: array(r.lines).map(line) } : {}),
      };
    }),
  };
}
export function parseCashImportResult(value: unknown): number {
  const v = object(value);
  if (v.ok !== true) throw new Error(typeof v.error === 'string' ? v.error : 'Import refused.');
  return number(v.created);
}
