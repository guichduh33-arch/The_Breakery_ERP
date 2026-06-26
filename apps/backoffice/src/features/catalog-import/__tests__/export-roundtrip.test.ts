// apps/backoffice/src/features/catalog-import/__tests__/export-roundtrip.test.ts
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { buildExportWorkbook } from '../buildExportWorkbook.js';
import { parseCatalogWorkbook, type CatalogPayload } from '../parseCatalogWorkbook.js';

const SAMPLE: CatalogPayload = {
  categories:  [{ name: 'Viennoiserie', dispatch_station: 'display', sort_order: 10 }],
  ingredients: [{ sku: 'ING-1', name: 'Farine', unit: 'kg', cost_price: 12000, category: 'Ingredients', min_stock_threshold: null, shelf_life_hours: null, purchase_unit: null, recipe_unit: 'g', opname_unit: null, sales_unit: null }],
  products:    [{ sku: 'PRD-1', name: 'Croissant', category: 'Viennoiserie', unit: 'pcs', retail_price: 25000, wholesale_price: null, description: null, image_url: null, visible_on_pos: true, is_favorite: false, shelf_life_hours: null, purchase_unit: null, recipe_unit: null, opname_unit: null, sales_unit: null }],
  units:       [{ product_sku: 'ING-1', code: 'g', factor_to_base: 0.001, tags: ['recipe'] }],
  variants:    [{ parent_sku: 'PRD-1', variant_axis: 'flavor', variant_label: 'Amande', sku: 'PRD-1-AMD', retail_price: 28000, image_url: null }],
  recipes:     [{ product_sku: 'PRD-1', material_sku: 'ING-1', quantity: 80, unit: 'g', notes: null }],
};

describe('buildExportWorkbook', () => {
  it('export → parse round-trips to an equivalent payload with no errors', () => {
    const wb = buildExportWorkbook(SAMPLE);
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const { payload, errors } = parseCatalogWorkbook(buf);
    expect(errors).toEqual([]);
    expect(payload!.products[0]!.sku).toBe('PRD-1');
    expect(payload!.units[0]!.tags).toEqual(['recipe']);
    expect(payload!.recipes[0]!.quantity).toBe(80);
    expect(payload!.variants[0]!.parent_sku).toBe('PRD-1');
  });
});
