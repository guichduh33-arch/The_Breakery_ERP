// apps/backoffice/src/features/data-import/__tests__/parseEntityWorkbook.test.ts
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseEntityWorkbook } from '../parseEntityWorkbook.js';
import type { EntityImportDef } from '../entityImportDef.js';

const DEF: EntityImportDef = {
  entity: 'widgets',
  sheetName: 'Widgets',
  rpcName: 'import_widgets_v1',
  columns: [
    { key: 'code',   required: true,  type: 'text' },
    { key: 'qty',    required: false, type: 'number' },
    { key: 'active', required: false, type: 'boolean' },
  ],
  example: { code: 'W-1', qty: 3, active: true },
  queryKeysToInvalidate: [['widgets']],
};

function toBuf(aoa: unknown[][], sheetName = 'Widgets'): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('parseEntityWorkbook', () => {
  it('parses typed rows and skips blank rows', () => {
    const buf = toBuf([
      ['code', 'qty', 'active'],
      ['W-1', '3', 'true'],
      [null, null, null],
      ['W-2', '5', 'no'],
    ]);
    const { rows, structureErrors, rowMap } = parseEntityWorkbook(buf, DEF);
    expect(structureErrors).toEqual([]);
    expect(rows).toEqual([
      { code: 'W-1', qty: 3, active: true },
      { code: 'W-2', qty: 5, active: false },
    ]);
    expect(rowMap).toEqual([2, 4]); // 1-based Excel rows, blank row 3 skipped
  });

  it('flags missing sheet, unknown column, missing required column and bad number', () => {
    const missing = parseEntityWorkbook(toBuf([['code']], 'Other'), DEF);
    expect(missing.structureErrors.some((e) => e.message.includes('Missing sheet'))).toBe(true);

    const bad = parseEntityWorkbook(
      toBuf([['name', 'qty'], ['x', 'abc']]),
      DEF,
    );
    expect(bad.structureErrors.some((e) => e.message.includes('Unknown column "name"'))).toBe(true);
    expect(bad.structureErrors.some((e) => e.message.includes('Required column "code" is missing'))).toBe(true);
    expect(bad.structureErrors.some((e) => e.message.includes('is not a number'))).toBe(true);
  });

  it('flags a missing required value on a present column', () => {
    const { structureErrors } = parseEntityWorkbook(
      toBuf([['code', 'qty'], ['', '3']]),
      DEF,
    );
    expect(structureErrors.some((e) => e.message === 'Required value missing')).toBe(true);
  });

  it('returns a fatal structure error for an unreadable buffer', () => {
    const { rows, structureErrors } = parseEntityWorkbook(new ArrayBuffer(4), DEF);
    expect(rows).toEqual([]);
    expect(structureErrors[0]?.message).toContain('not a readable');
  });
});
