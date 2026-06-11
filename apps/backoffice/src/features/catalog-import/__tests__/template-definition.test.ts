// apps/backoffice/src/features/catalog-import/__tests__/template-definition.test.ts
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { CATALOG_SHEETS } from '../templateDefinition.js';
import { buildTemplateWorkbook } from '../buildTemplateWorkbook.js';

describe('templateDefinition', () => {
  it('defines the 6 sheets in import order', () => {
    expect(CATALOG_SHEETS.map((s) => s.name)).toEqual([
      'Categories', 'Ingredients', 'Products', 'Units', 'Variants', 'Recipes',
    ]);
  });

  it('every sheet has its required key columns', () => {
    const req = (name: string) =>
      CATALOG_SHEETS.find((s) => s.name === name)!.columns.filter((c) => c.required).map((c) => c.key);
    expect(req('Categories')).toEqual(['name']);
    expect(req('Ingredients')).toEqual(['sku', 'name', 'unit', 'cost_price']);
    expect(req('Products')).toEqual(['sku', 'name', 'category', 'retail_price']);
    expect(req('Units')).toEqual(['product_sku', 'code', 'factor_to_base']);
    expect(req('Variants')).toEqual(['parent_sku', 'variant_axis', 'variant_label', 'sku']);
    expect(req('Recipes')).toEqual(['product_sku', 'material_sku', 'quantity']);
  });
});

describe('buildTemplateWorkbook', () => {
  it('produces a workbook with 6 sheets, headers + 1 example row each', () => {
    const wb = buildTemplateWorkbook();
    expect(wb.SheetNames).toEqual(CATALOG_SHEETS.map((s) => s.name));
    for (const def of CATALOG_SHEETS) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[def.name]!, { defval: null });
      expect(rows).toHaveLength(1); // example row
    }
  });
});
