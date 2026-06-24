import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { purchasesImportDef } from '@/features/purchasing/import/purchasesImportDef.js';
import { buildTemplateWorkbook } from '@/features/data-import/buildEntityWorkbook.js';
import { parseEntityWorkbook } from '@/features/data-import/parseEntityWorkbook.js';

describe('purchasesImportDef', () => {
  it('template round-trips with the required line columns', () => {
    const buf = XLSX.write(buildTemplateWorkbook(purchasesImportDef), { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const { rows, structureErrors } = parseEntityWorkbook(buf, purchasesImportDef);
    expect(structureErrors).toEqual([]);
    expect(rows[0]?.po_reference).toBe('PO-2026-001');
    expect(rows[0]?.quantity).toBe(10);
    expect(rows[0]?.unit_cost).toBe(12000);
  });

  it('parses two grouped lines as two flat rows', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['po_reference','supplier_code','order_date','payment_terms','notes','product_sku','quantity','unit_cost','unit'],
      ['PO-A','SUP-FLOUR','2026-01-10','credit','','SKU-1','5','1000','kg'],
      ['PO-A','SUP-FLOUR','2026-01-10','credit','','SKU-2','3','2000','kg'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Purchases');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const { rows, structureErrors } = parseEntityWorkbook(buf, purchasesImportDef);
    expect(structureErrors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.product_sku)).toEqual(['SKU-1', 'SKU-2']);
  });
});
