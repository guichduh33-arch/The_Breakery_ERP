// packages/domain/src/combos/__tests__/isComboProduct.test.ts
import { describe, it, expect } from 'vitest';
import { isComboProduct } from '../isComboProduct.js';

describe('isComboProduct', () => {
  it('returns true for product_type combo', () => {
    expect(isComboProduct({ product_type: 'combo' })).toBe(true);
  });

  it('returns false for product_type finished', () => {
    expect(isComboProduct({ product_type: 'finished' })).toBe(false);
  });

  it('works on a partial product shape (Pick)', () => {
    const partial = { product_type: 'combo' as const };
    expect(isComboProduct(partial)).toBe(true);
  });

  it('returns false for finished partial product shape', () => {
    const partial = { product_type: 'finished' as const };
    expect(isComboProduct(partial)).toBe(false);
  });
});
