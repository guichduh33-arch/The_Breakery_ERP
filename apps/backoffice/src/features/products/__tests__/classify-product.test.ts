// apps/backoffice/src/features/products/__tests__/classify-product.test.ts
//
// classifyProduct now derives the conceptual product type from the category's
// `category_type` (the real source of truth used across S46 purchasing), not a
// SKU-prefix guess. The old heuristic mislabelled raw materials whose SKU did
// not start with RAW/CON/HAS (e.g. SEE-012 Almond Ground, KIT-010 Aluminium
// Foil) as "Finished Product".

import { describe, it, expect } from 'vitest';
import { classifyProduct } from '../types.js';

describe('classifyProduct', () => {
  it('classifies by category_type (source of truth)', () => {
    expect(classifyProduct({ product_type: 'finished', sku: 'SEE-012', category_type: 'raw_material' })).toBe('raw');
    expect(classifyProduct({ product_type: 'finished', sku: 'KIT-010', category_type: 'raw_material' })).toBe('raw');
    expect(classifyProduct({ product_type: 'finished', sku: 'SFG-054', category_type: 'semi_finished' })).toBe('semi-finished');
    expect(classifyProduct({ product_type: 'finished', sku: 'COF-012', category_type: 'finished' })).toBe('finished');
  });

  it('does NOT trust the SKU prefix when category_type disagrees', () => {
    // HAS-006 Almond Butter sits in a `finished` category despite the HAS prefix.
    expect(classifyProduct({ product_type: 'finished', sku: 'HAS-006', category_type: 'finished' })).toBe('finished');
  });

  it('treats combo products as combo regardless of category_type', () => {
    expect(classifyProduct({ product_type: 'combo', sku: 'COMBO-001', category_type: 'finished' })).toBe('combo');
  });

  it('falls back to the SKU-prefix heuristic only when category_type is absent', () => {
    expect(classifyProduct({ product_type: 'finished', sku: 'SFG-001', category_type: null })).toBe('semi-finished');
    expect(classifyProduct({ product_type: 'finished', sku: 'RAW-001' })).toBe('raw'); // category_type omitted
    expect(classifyProduct({ product_type: 'finished', sku: 'COF-001', category_type: null })).toBe('finished');
  });
});
