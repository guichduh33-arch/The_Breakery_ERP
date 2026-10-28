import { bankDate } from './dates.js';
import { decimalCents, decimalText, localizedBankAmount } from './money.js';
import type { BankImportPayload, BankStatementRow } from '@/lib/bankAttemptSchema.js';

export interface StatementSheet { name: string; rows: unknown[][]; formulas: string[]; date1904: boolean }
export interface StatementFile { name: string; sha256: string; sheets: StatementSheet[] }
export interface StatementMapping {
  headerRow: number; date: number; description: number; reference: number; balance: number;
  mode: 'signed' | 'debit-credit'; amount: number; debit: number; credit: number;
  creditDirection: 'in' | 'out'; numbers: 'dot' | 'comma'; dates: 'iso' | 'dmy' | 'mdy';
}
export const defaultMapping: StatementMapping = {
  headerRow: 1, date: -1, description: -1, reference: -1, balance: -1,
  mode: 'signed', amount: -1, debit: -1, credit: -1,
  creditDirection: 'in', numbers: 'dot', dates: 'iso',
};
const blank = (value: unknown) => value === undefined || value === null || value === '';

/** Lecture bornée ; aucune macro ni formule n'est exécutée. */
export async function readStatement(file: File, separator: ',' | ';' | '\t'): Promise<StatementFile> {
  if (!/\.(csv|xlsx|xls|xlsb)$/i.test(file.name) || file.size === 0 || file.size > 10 * 1024 * 1024) {
    throw new Error('Choose a CSV or Excel file up to 10 MB.');
  }
  const bytes = await file.arrayBuffer();
  const sha = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = Array.from(new Uint8Array(sha), (n) => n.toString(16).padStart(2, '0')).join('');
  const xlsx = await import('xlsx');
  const workbook = xlsx.read(bytes, { type: 'array', raw: true, cellDates: false,
    cellFormula: true, bookVBA: false, sheetRows: 6002, FS: separator });
  const sheets = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name]!;
    const sourceRange: unknown = sheet['!fullref'] ?? sheet['!ref'];
    const range = xlsx.utils.decode_range(typeof sourceRange === 'string' ? sourceRange : 'A1');
    if (range.e.r >= 6001 || range.e.c >= 200) throw new Error('Sheet exceeds 6,001 rows or 200 columns. Split the statement explicitly before importing.');
    const formulas = Object.keys(sheet).filter((address) => {
      const cell: unknown = sheet[address];
      return !address.startsWith('!') && cell !== null && typeof cell === 'object' && 'f' in cell && typeof cell.f === 'string';
    });
    // range:0 préserve le numéro de ligne physique, même si !ref commence plus bas.
    const rows = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: true, range: 0 });
    return { name, rows, formulas, date1904: workbook.Workbook?.WBProps?.date1904 === true };
  });
  return { name: file.name, sha256, sheets };
}

export function normalizeStatement(sheet: StatementSheet, mapping: StatementMapping): { rows: BankStatementRow[]; errors: string[] } {
  const errors: string[] = [];
  const rows: BankStatementRow[] = [];
  const columns = [mapping.date, mapping.description,
    ...(mapping.mode === 'signed' ? [mapping.amount] : [mapping.debit, mapping.credit]),
    ...[mapping.reference, mapping.balance].filter((n) => n >= 0)];
  if (!Number.isInteger(mapping.headerRow) || mapping.headerRow < 1 || mapping.headerRow > 1000
    || columns.some((n) => !Number.isInteger(n) || n < 0 || n >= 200) || new Set(columns).size !== columns.length) {
    return { rows, errors: ['Choose distinct columns and a valid header row.'] };
  }
  const formulaAddresses = new Set(sheet.formulas);
  function columnName(index: number): string {
    let result = ''; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
    return result;
  }
  let previous = '';
  sheet.rows.slice(mapping.headerRow).forEach((source, index) => {
    const sourceRow = mapping.headerRow + index + 1;
    if (source.every(blank)) return;
    try {
      if (columns.some((column) => formulaAddresses.has(`${columnName(column)}${sourceRow}`))) throw new Error('Mapped cells must contain values, not formulas.');
      const date = bankDate(source[mapping.date], mapping.dates, sheet.date1904);
      if (date < previous) throw new Error('Rows must be in ascending transaction date order.');
      const description = source[mapping.description];
      if (typeof description !== 'string' || !description.trim() || description.trim().length > 1000) throw new Error('A description of up to 1,000 characters is required.');
      let amount: string;
      if (mapping.mode === 'signed') amount = localizedBankAmount(source[mapping.amount], mapping.numbers);
      else {
        const debit = blank(source[mapping.debit]) ? 0n : decimalCents(localizedBankAmount(source[mapping.debit], mapping.numbers));
        const credit = blank(source[mapping.credit]) ? 0n : decimalCents(localizedBankAmount(source[mapping.credit], mapping.numbers));
        if (debit < 0n || credit < 0n || (debit !== 0n && credit !== 0n)) throw new Error('Use one non-negative debit or credit per row.');
        amount = decimalText(mapping.creditDirection === 'in' ? credit - debit : debit - credit);
      }
      if (decimalCents(amount) === 0n) throw new Error('A non-zero amount is required.');
      const referenceValue = mapping.reference < 0 ? null : source[mapping.reference];
      if (!blank(referenceValue) && typeof referenceValue !== 'string') throw new Error('References must be stored as text to preserve leading zeros.');
      const reference = typeof referenceValue === 'string' ? referenceValue.trim() : undefined;
      if (reference && reference.length > 255) throw new Error('Reference exceeds 255 characters.');
      const balanceValue = mapping.balance < 0 ? null : source[mapping.balance];
      const balance = blank(balanceValue) ? null : localizedBankAmount(balanceValue, mapping.numbers);
      rows.push({ source_row: sourceRow, date, amount, description: description.trim(), ...(reference ? { reference } : {}), balance });
      previous = date;
    } catch (error) { errors.push(`Row ${sourceRow}: ${(error as Error).message}`); }
  });
  if (rows.length === 0) errors.push('No valid transactions were found.');
  if (rows.length > 5000) errors.push('A reconciliation supports at most 5,000 transactions.');
  return { rows, errors };
}

export function makeImportPayload(file: StatementFile, sheet: StatementSheet, mapping: StatementMapping,
  header: Omit<BankImportPayload, 'rows' | 'currency' | 'source_sha256' | 'file_name' | 'sheet_name'>): BankImportPayload {
  const parsed = normalizeStatement(sheet, mapping);
  if (parsed.errors.length) throw new Error(parsed.errors.join('\n'));
  if (bankDate(header.period_start, 'iso') > bankDate(header.period_end, 'iso')) throw new Error('Invalid statement period.');
  if (parsed.rows.some((row) => row.date < header.period_start || row.date > header.period_end)) throw new Error('A transaction is outside the statement period.');
  return { ...header, currency: 'IDR', source_sha256: file.sha256, file_name: file.name, sheet_name: sheet.name, rows: parsed.rows };
}
