import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildOpnameWorkbook, parseOpnameWorkbook } from '../opnameWorkbook.js';

const products = [
  { id: 'a', sku: '001', name: 'Flour', unit: 'kg' },
  { id: 'b', sku: '002', name: 'Egg', unit: 'pcs' },
];
function parse(rows: unknown[][]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['sku', 'name', 'unit', 'counted_qty', 'notes'], ...rows,
  ]), 'Stock count');
  return parseOpnameWorkbook(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, products);
}
describe('stock count workbook', () => {
  it('prefills every item with blank counts and no expected stock', () => {
    const book = buildOpnameWorkbook(products);
    const data = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets['Stock count']!, { header: 1 });
    expect(data).toEqual([
      ['sku', 'name', 'unit', 'counted_qty', 'notes'],
      ['001', 'Flour', 'kg', '', ''], ['002', 'Egg', 'pcs', '', ''],
    ]);
    expect(parseOpnameWorkbook(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, products)).toEqual({ rows: [], errors: [] });
  });
  it('skips blank counts but preserves zero and decimal counts', () => {
    expect(parse([['001', 'Flour', 'kg', ''], ['002', 'Egg', 'pcs', 0]]).rows)
      .toEqual([{ productId: 'b', sku: '002', unit: 'pcs', quantity: 0, notes: '' }]);
    expect(parse([['001', 'Flour', 'kg', 1.125, 'Opened']]).rows[0]?.quantity).toBe(1.125);
  });
  it.each([-1, 10000000, 0.0001, 'NaN', 'Infinity', '1,5', true])('rejects invalid count %s', (value) => {
    expect(parse([['001', 'Flour', 'kg', value]]).errors).toHaveLength(1);
  });
  it('rejects unknown SKUs, duplicate SKUs and changed units', () => {
    expect(parse([['missing', '', 'kg', 1]]).errors).toHaveLength(1);
    expect(parse([['001', '', 'kg', 1], ['001', '', 'kg', 2]]).errors).toHaveLength(1);
    expect(parse([['001', '', 'g', 1000]]).errors).toHaveLength(1);
  });
  it('rejects formulas even when they have cached numeric values', () => {
    const book = buildOpnameWorkbook(products);
    book.Sheets['Stock count']!.D2 = { t: 'n', v: 1, f: '1+0' };
    expect(parseOpnameWorkbook(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, products).errors).toHaveLength(1);
  });
});
