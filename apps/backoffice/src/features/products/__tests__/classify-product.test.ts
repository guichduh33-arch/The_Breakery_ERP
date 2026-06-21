// apps/backoffice/src/features/products/__tests__/classify-product.test.ts
//
// classifyProduct must derive the conceptual type from categories.category_type
// (authoritative), not the SKU prefix. Regression: Almond Ground (SEE-012, a
// raw material) was shown as "Finished" because its SKU prefix wasn't in the
// old RAW/CON/HAS/SFG allowlist.

import { describe, it, expect } from 'vitest';
import { classifyProduct } from '../types.js';

type Args = Parameters<typeof classifyProduct>[0];
const base: Args = {
  product_type: 'finished',
  sku: 'SEE-012',
  category_type: null,
  is_semi_finished: false,
};

describe('classifyProduct', () => {
  it('uses category_type as the source of truth (SEE-012 raw material → raw)', () => {
    expect(classifyProduct({ ...base, category_type: 'raw_material' })).toBe('raw');
  });

  it('maps semi_finished category → semi-finished', () => {
    expect(classifyProduct({ ...base, sku: 'PAC-001', category_type: 'semi_finished' })).toBe('semi-finished');
  });

  it('maps finished category → finished', () => {
    expect(classifyProduct({ ...base, sku: 'CR-NAT', category_type: 'finished' })).toBe('finished');
  });

  it('combo wins regardless of category_type', () => {
    expect(classifyProduct({ ...base, product_type: 'combo', category_type: 'raw_material' })).toBe('combo');
  });

  it('falls back to is_semi_finished when category_type is null', () => {
    expect(classifyProduct({ ...base, category_type: null, is_semi_finished: true })).toBe('semi-finished');
  });

  it('falls back to the legacy SKU heuristic when category_type is null', () => {
    expect(classifyProduct({ ...base, sku: 'RAW-001', category_type: null })).toBe('raw');
    expect(classifyProduct({ ...base, sku: 'SFG-003', category_type: null })).toBe('semi-finished');
  });

  it('defaults to finished when nothing else matches', () => {
    expect(classifyProduct({ ...base, sku: 'SEE-012', category_type: null })).toBe('finished');
  });
});
