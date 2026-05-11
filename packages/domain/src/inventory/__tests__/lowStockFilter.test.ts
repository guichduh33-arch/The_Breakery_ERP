// packages/domain/src/inventory/__tests__/lowStockFilter.test.ts

import { describe, expect, it } from 'vitest';
import { lowStockFilter } from '../lowStockFilter.js';

describe('lowStockFilter', () => {
  it('threshold = 0 disables tracking — never returns the row', () => {
    const products = [
      { id: 'a', currentStock: 0, minStockThreshold: 0 },
      { id: 'b', currentStock: 1, minStockThreshold: 0 },
    ];
    expect(lowStockFilter(products)).toEqual([]);
  });

  it('excludes rows where currentStock >= threshold', () => {
    const products = [
      { id: 'a', currentStock: 10, minStockThreshold: 5 },
      { id: 'b', currentStock: 5, minStockThreshold: 5 }, // equal → NOT low
    ];
    expect(lowStockFilter(products)).toEqual([]);
  });

  it('includes rows where currentStock < threshold', () => {
    const products = [
      { id: 'a', currentStock: 2, minStockThreshold: 5 },
      { id: 'b', currentStock: 0, minStockThreshold: 1 },
    ];
    const result = lowStockFilter(products);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('preserves input order in mixed lists', () => {
    const products = [
      { id: 'ok', currentStock: 10, minStockThreshold: 5 },
      { id: 'low-1', currentStock: 1, minStockThreshold: 5 },
      { id: 'disabled', currentStock: 0, minStockThreshold: 0 },
      { id: 'low-2', currentStock: 4, minStockThreshold: 10 },
    ];
    expect(lowStockFilter(products).map((p) => p.id)).toEqual(['low-1', 'low-2']);
  });

  it('returns [] for an empty input', () => {
    expect(lowStockFilter([])).toEqual([]);
  });
});
