import { describe, expect, it } from 'vitest';
import { bankDate } from '../dates.js';
import { bankMoney, decimalCents, decimalText, localizedBankAmount } from '../money.js';
import { defaultMapping, makeImportPayload, normalizeStatement, readStatement, type StatementFile, type StatementSheet } from '../statementParser.js';

const sheet: StatementSheet = { name: 'Bank',date1904: false,formulas: [],rows: [
  ['Date','Description','Debit','Credit','Reference','Balance'],
  ['24/10/2026','Supplier payment','1.379.998,62',null,'000123','8.620.001,38'],
  ['25/10/2026','Card settlement',null,'100.000,00','000124','8.720.001,38'],
] };
const mapping = { ...defaultMapping,date: 0,description: 1,debit: 2,credit: 3,reference: 4,balance: 5,mode: 'debit-credit' as const,numbers: 'comma' as const,dates: 'dmy' as const };
const account = '11111111-1111-4111-8111-111111111111';
describe('bank statement money and dates',() => {
  it('keeps real fractional IDR exactly and does not apply a matching tolerance',() => {
    expect(decimalCents(1379998.62)).toBe(137999862n);
    expect(decimalCents('0.29') + decimalCents('0.01')).toBe(30n);
    expect(decimalText(-100000001n)).toBe('-1000000.01');
    expect(bankMoney(1379998.62)).toBe('Rp 1,379,998.62');
    expect(bankMoney(null)).toBe('Unavailable');
    for (const value of ['1.001',1.005,'1e4','Infinity',Infinity,'1000000000000.00',0.1 + 0.2]) expect(() => decimalCents(value)).toThrow();
    expect(decimalCents('999999999999.99')).toBe(99999999999999n);
  });
  it('requires the chosen grouping and decimal conventions',() => {
    expect(localizedBankAmount('Rp 1.379.998,62','comma')).toBe('1379998.62');
    expect(localizedBankAmount('(1,379,998.62)','dot')).toBe('-1379998.62');
    expect(() => localizedBankAmount('1.379.998,62','dot')).toThrow();
    expect(() => localizedBankAmount('1,23.00','dot')).toThrow();
    expect(() => localizedBankAmount('1.000,001','comma')).toThrow();
  });
  it('handles explicit dates and both Excel epochs without timezone drift',() => {
    expect(bankDate('01/02/2026','dmy')).toBe('2026-02-01');
    expect(bankDate('01/02/2026','mdy')).toBe('2026-01-02');
    expect(bankDate(61,'iso')).toBe('1900-03-01');
    expect(bankDate(0,'iso',true)).toBe('1904-01-01');
    expect(bankDate('2024-02-29','iso')).toBe('2024-02-29');
    for (const value of [60,0,-1,'2026-02-29','31/04/2026','2026-01-01T00:00:00Z']) expect(() => bankDate(value,'dmy')).toThrow();
    expect(() => bankDate('01/02/2026','iso')).toThrow();
  });
  it('reads a two-digit year as 20YY, as the bank exports it, and still rejects invalid dates',() => {
    expect(bankDate('01/10/26','dmy')).toBe('2026-10-01');
    expect(bankDate('31.10.26','dmy')).toBe('2026-10-31');
    expect(bankDate('10/31/26','mdy')).toBe('2026-10-31');
    expect(bankDate('29/02/24','dmy')).toBe('2024-02-29');
    expect(bankDate('1/2/00','dmy')).toBe('2000-02-01');
    for (const value of ['29/02/26','31/04/26','32/10/26','01/13/26','01/10/026','01/10/6','01/10-26']) expect(() => bankDate(value,'dmy')).toThrow();
    expect(() => bankDate('01/10/26','iso')).toThrow();
  });
});
describe('bank statement normalization',() => {
  it('preserves physical source rows, debit direction, references and real cents',() => {
    expect(normalizeStatement(sheet,mapping)).toEqual({ errors: [],rows: [
      { source_row: 2,date: '2026-10-24',description: 'Supplier payment',amount: '-1379998.62',reference: '000123',balance: '8620001.38' },
      { source_row: 3,date: '2026-10-25',description: 'Card settlement',amount: '100000.00',reference: '000124',balance: '8720001.38' },
    ] });
    const reversed = normalizeStatement(sheet,{ ...mapping,creditDirection: 'out' });
    expect(reversed.rows[0]?.amount).toBe('1379998.62');
  });
  it('rejects ambiguous input, formulas and extra decimals instead of partially importing',() => {
    for (const rows of [
      [['Date','Description','Debit','Credit'],['2026-10-24','Both',10,20]],
      [['Date','Description','Debit','Credit'],['2026-10-24','Negative',-10,null]],
      [['Date','Description','Debit','Credit'],['2026-10-24','Too precise','10.001',null]],
    ]) expect(normalizeStatement({ ...sheet,rows },{ ...mapping,reference: -1,balance: -1,numbers: 'dot',dates: 'iso' }).errors.length).toBeGreaterThan(0);
    expect(normalizeStatement({ ...sheet,formulas: ['C2'] },mapping).errors[0]).toContain('not formulas');
    expect(normalizeStatement(sheet,{ ...mapping,credit: 2 }).errors[0]).toContain('distinct columns');
    const file: StatementFile = { name: 'bank.xlsx',sha256: 'a'.repeat(64),sheets: [{ ...sheet,formulas: ['C2'] }] };
    expect(() => makeImportPayload(file,file.sheets[0]!,mapping,{ account_id: account,period_start: '2026-10-01',period_end: '2026-10-31',opening_balance: null,closing_balance: null,duplicate_acknowledged: false })).toThrow('Row 2');
  });
  it('does not discard legitimate identical movements or invent missing balances',() => {
    const duplicate = { ...sheet,rows: [sheet.rows[0]!,sheet.rows[1]!,sheet.rows[1]!] };
    const result = normalizeStatement(duplicate,{ ...mapping,balance: -1 });
    expect(result.errors).toEqual([]); expect(result.rows).toHaveLength(2);
    expect(result.rows.map((row) => row.source_row)).toEqual([2,3]);
    expect(result.rows.every((row) => row.balance === null)).toBe(true);
  });
  it('imports a bank export with dd/mm/yy text dates, blank rows and dot-decimal debit/credit text',() => {
    const exported: StatementSheet = { ...sheet,rows: [
      ['Date','Description','Debit','Credit','Reference','Balance'],
      ['01/10/26','Opening transfer',null,'250000.00','A1','1250000.00'],
      [null,null,null,null,null,null],
      ['02/10/26','Supplier payment','1379998.62',null,'A2','-129998.62'],
      ['31/10/26','Card settlement',null,'100000.00','A3','-29998.62'],
    ] };
    const result = normalizeStatement(exported,{ ...mapping,numbers: 'dot' });
    expect(result.errors).toEqual([]);
    expect(result.rows.map((row) => [row.source_row,row.date,row.amount])).toEqual([
      [2,'2026-10-01','250000.00'],[4,'2026-10-02','-1379998.62'],[5,'2026-10-31','100000.00'],
    ]);
  });
  it('counts one issue per bad row plus one summary line when nothing is valid',() => {
    const bad = { ...sheet,rows: [sheet.rows[0]!,['01/10/26','A',null,'1.00',null,null],['02/10/26','B',null,'2.00',null,null]] };
    const result = normalizeStatement(bad,{ ...mapping,numbers: 'dot',dates: 'iso',reference: -1,balance: -1 });
    expect(result.errors).toEqual(['Row 2: Date does not match the selected format.','Row 3: Date does not match the selected format.','No valid transactions were found.']);
  });
  it('rejects numeric references, descending dates and a transaction outside the declared period',() => {
    expect(normalizeStatement({ ...sheet,rows: [sheet.rows[0]!,['24/10/2026','Payment',100,null,123,null]] },mapping).errors[0]).toContain('text');
    expect(normalizeStatement({ ...sheet,rows: [sheet.rows[0]!,sheet.rows[2]!,sheet.rows[1]!] },mapping).errors[0]).toContain('ascending');
    expect(() => makeImportPayload({ name: 'a.xlsx',sha256: 'a'.repeat(64),sheets: [sheet] },sheet,mapping,{ account_id: account,period_start: '2026-10-25',period_end: '2026-10-31',opening_balance: null,closing_balance: null,duplicate_acknowledged: false })).toThrow('outside');
  });
  it('reads CSV without interpreting formula strings and hashes the exact source bytes',async () => {
    const buffer = new TextEncoder().encode('Date;Description;Amount\n2026-10-24;=HYPERLINK("example");-10.25');
    const file = { name: 'bank.csv',size: buffer.length,arrayBuffer: () => Promise.resolve(buffer.buffer) } as File;
    const result = await readStatement(file,';');
    expect(result.sha256).toMatch(/^[a-f\d]{64}$/);
    expect(result.sheets[0]?.rows[1]?.[1]).toContain('HYPERLINK');
    expect(result.sheets[0]?.formulas).toEqual([]);
  });
});
