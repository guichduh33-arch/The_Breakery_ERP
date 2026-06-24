// apps/backoffice/src/features/data-import/__tests__/buildEntityWorkbook.test.ts
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { buildTemplateWorkbook, buildExportWorkbook } from '../buildEntityWorkbook.js';
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

function bufOf(wb: XLSX.WorkBook): ArrayBuffer {
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('buildEntityWorkbook', () => {
  it('template has the sheet, the headers and the example row', () => {
    const { rows, structureErrors } = parseEntityWorkbook(bufOf(buildTemplateWorkbook(DEF)), DEF);
    expect(structureErrors).toEqual([]);
    expect(rows).toEqual([{ code: 'W-1', qty: 3, active: true }]);
  });

  it('export round-trips through the parser', () => {
    const wb = buildExportWorkbook(DEF, [
      { code: 'A', qty: 1, active: false, ignored: 'x' },
      { code: 'B', qty: null, active: true },
    ]);
    const { rows, structureErrors } = parseEntityWorkbook(bufOf(wb), DEF);
    expect(structureErrors).toEqual([]);
    expect(rows).toEqual([
      { code: 'A', qty: 1, active: false },
      { code: 'B', qty: null, active: true },
    ]);
  });
});
