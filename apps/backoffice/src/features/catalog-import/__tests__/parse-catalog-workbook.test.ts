// apps/backoffice/src/features/catalog-import/__tests__/parse-catalog-workbook.test.ts
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { CATALOG_SHEETS } from '../templateDefinition.js';
import { buildTemplateWorkbook } from '../buildTemplateWorkbook.js';
import { parseCatalogWorkbook } from '../parseCatalogWorkbook.js';

function wbToBuffer(wb: XLSX.WorkBook): ArrayBuffer {
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return out;
}

function makeWb(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  // always create all 6 sheets with headers; override rows where provided
  for (const def of CATALOG_SHEETS) {
    const headers = def.columns.map((c) => c.key);
    const rows = sheets[def.name] ?? [];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, def.name);
  }
  return wbToBuffer(wb);
}

describe('parseCatalogWorkbook', () => {
  it('round-trips the generated template without structure errors', () => {
    const { payload, errors } = parseCatalogWorkbook(wbToBuffer(buildTemplateWorkbook()));
    expect(errors).toEqual([]);
    expect(payload).not.toBeNull();
    expect(payload!.categories).toHaveLength(1); // example row parsed
  });

  it('flags a missing sheet', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['name']]), 'Categories');
    const { payload, errors } = parseCatalogWorkbook(wbToBuffer(wb));
    expect(payload).toBeNull();
    expect(errors.some((e) => e.message.includes('Ingredients'))).toBe(true);
  });

  it('flags an empty required cell with sheet + row', () => {
    const buf = makeWb({ Products: [[null, 'Croissant', 'Cat', 'pcs', 25000, null, null, null, null, null, null, null, null, null, null]] });
    const { errors } = parseCatalogWorkbook(buf);
    const err = errors.find((e) => e.sheet === 'Products' && e.column === 'sku');
    expect(err).toBeDefined();
    expect(err!.row).toBe(2); // header = row 1
  });

  it('flags a non-numeric value in a number column', () => {
    const buf = makeWb({ Ingredients: [['ING-1', 'Farine', 'kg', 'abc', null, null, null, null, null, null, null]] });
    const { errors } = parseCatalogWorkbook(buf);
    expect(errors.some((e) => e.column === 'cost_price')).toBe(true);
  });

  it('flags duplicate SKUs across Ingredients/Products/Variants', () => {
    const buf = makeWb({
      Ingredients: [['DUP-1', 'Farine', 'kg', 1000, null, null, null, null, null, null, null]],
      Products:    [['DUP-1', 'Croissant', 'Cat', 'pcs', 25000, null, null, null, null, null, null, null, null, null, null]],
    });
    const { errors } = parseCatalogWorkbook(buf);
    expect(errors.some((e) => e.message.includes('DUP-1'))).toBe(true);
  });

  it('parses tags CSV cell into an array and booleans into booleans', () => {
    const buf = makeWb({
      Ingredients: [['ING-2', 'Beurre', 'kg', 95000, null, null, null, null, null, null, null]],
      Units:       [['ING-2', 'g', 0.001, 'recipe, purchase']],
      Products:    [['PRD-2', 'Pain', 'Cat', 'pcs', 15000, null, null, null, 'FALSE', null, null, null, null, null, null]],
    });
    const { payload, errors } = parseCatalogWorkbook(buf);
    expect(errors).toEqual([]);
    expect(payload!.units[0]!.tags).toEqual(['recipe', 'purchase']);
    expect(payload!.products[0]!.visible_on_pos).toBe(false);
  });

  it('builds rowMaps mapping payload ordinals back to Excel rows (blank rows skipped)', () => {
    // Middle row is whitespace-only: the parser skips it, but it still occupies
    // Excel row 3 — so the two accepted categories live on Excel rows 2 and 4.
    const buf = makeWb({
      Categories: [
        ['Cat A', null, null],
        ['', '', ''],
        ['Cat B', null, null],
      ],
    });
    const { payload, errors, rowMaps } = parseCatalogWorkbook(buf);
    expect(errors).toEqual([]);
    expect(payload!.categories).toHaveLength(2);
    expect(rowMaps.categories).toEqual([2, 4]);
  });

  it('flags a duplicated header column once, at row 1', () => {
    // Build a Categories sheet whose header row contains "name" twice.
    const wb = XLSX.utils.book_new();
    for (const def of CATALOG_SHEETS) {
      const headers = def.columns.map((c) => c.key);
      if (def.name === 'Categories') headers.push('name'); // duplicate
      const ws = XLSX.utils.aoa_to_sheet([headers, ...(def.name === 'Categories' ? [['Cat A', null, null, null]] : [])]);
      XLSX.utils.book_append_sheet(wb, ws, def.name);
    }
    const { errors } = parseCatalogWorkbook(wbToBuffer(wb));
    const dup = errors.filter((e) => e.sheet === 'Categories' && e.message.includes('Duplicate column'));
    expect(dup).toHaveLength(1);
    expect(dup[0]!.row).toBe(1);
    expect(dup[0]!.column).toBe('name');
  });
});
