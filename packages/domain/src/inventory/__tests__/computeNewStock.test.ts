// packages/domain/src/inventory/__tests__/computeNewStock.test.ts

import { describe, expect, it } from 'vitest';
import { computeNewStock } from '../computeNewStock.js';

describe('computeNewStock', () => {
  it('0 + 0 = 0', () => {
    expect(computeNewStock(0, 0)).toBe(0);
  });

  it('adds a positive delta (10 + 5 = 15)', () => {
    expect(computeNewStock(10, 5)).toBe(15);
  });

  it('subtracts with a negative delta (10 - 3 = 7)', () => {
    expect(computeNewStock(10, -3)).toBe(7);
  });

  it('does NOT clamp to zero — returns the raw projection (0 - 5 = -5)', () => {
    // Server is authoritative; UI validators enforce non-negative invariants where required.
    expect(computeNewStock(0, -5)).toBe(-5);
  });

  it('keeps decimal precision within JS float tolerance', () => {
    // 0.1 + 0.2 = 0.30000000000000004 in IEEE-754. Caller is responsible
    // for rounding to product-precision (grams / unit) before display.
    const result = computeNewStock(0.1, 0.2);
    expect(result).toBeCloseTo(0.3, 10);
  });
});
