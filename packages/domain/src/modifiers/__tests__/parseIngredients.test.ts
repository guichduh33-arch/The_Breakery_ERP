import { describe, it, expect } from 'vitest';
import { parseModifierIngredientsToDeduct } from '../parseIngredients.js';

describe('parseModifierIngredientsToDeduct', () => {
  it('parses a well-formed array', () => {
    const input = [{ product_id: 'p1', qty: 30, unit: 'ml' }];
    expect(parseModifierIngredientsToDeduct(input)).toEqual([
      { product_id: 'p1', qty: 30, unit: 'ml' },
    ]);
  });

  it('returns [] for a non-array', () => {
    expect(parseModifierIngredientsToDeduct(null)).toEqual([]);
    expect(parseModifierIngredientsToDeduct({})).toEqual([]);
    expect(parseModifierIngredientsToDeduct('x')).toEqual([]);
  });

  it('drops rows with missing or empty product_id', () => {
    const input = [
      { product_id: '', qty: 1, unit: 'g' },
      { qty: 1, unit: 'g' },
      { product_id: 'ok', qty: 1, unit: 'g' },
    ];
    expect(parseModifierIngredientsToDeduct(input)).toEqual([
      { product_id: 'ok', qty: 1, unit: 'g' },
    ]);
  });

  it('drops rows with non-positive or non-finite qty', () => {
    const input = [
      { product_id: 'a', qty: 0, unit: 'g' },
      { product_id: 'b', qty: -5, unit: 'g' },
      { product_id: 'c', qty: Number.NaN, unit: 'g' },
      { product_id: 'd', qty: 2, unit: 'g' },
    ];
    expect(parseModifierIngredientsToDeduct(input)).toEqual([
      { product_id: 'd', qty: 2, unit: 'g' },
    ]);
  });

  it('coerces numeric-string qty and drops empty unit', () => {
    const input = [
      { product_id: 'a', qty: '15', unit: 'ml' },
      { product_id: 'b', qty: 3, unit: '' },
    ];
    expect(parseModifierIngredientsToDeduct(input)).toEqual([
      { product_id: 'a', qty: 15, unit: 'ml' },
    ]);
  });
});
