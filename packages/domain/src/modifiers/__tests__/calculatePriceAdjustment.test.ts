// packages/domain/src/modifiers/__tests__/calculatePriceAdjustment.test.ts
import { describe, it, expect } from 'vitest';
import { calculatePriceAdjustment, calculateLineTotal } from '../calculatePriceAdjustment';

describe('calculatePriceAdjustment', () => {
  it('returns 0 for empty selections', () => {
    expect(calculatePriceAdjustment([])).toBe(0);
  });

  it('sums positive adjustments', () => {
    expect(
      calculatePriceAdjustment([
        { group_name: 'Milk', option_label: 'Oat', price_adjustment: 5000 },
        { group_name: 'Size', option_label: 'Large', price_adjustment: 7000 },
      ]),
    ).toBe(12000);
  });

  it('handles zero adjustments mixed with non-zero', () => {
    expect(
      calculatePriceAdjustment([
        { group_name: 'Temp', option_label: 'Hot', price_adjustment: 0 },
        { group_name: 'Milk', option_label: 'Oat', price_adjustment: 5000 },
      ]),
    ).toBe(5000);
  });
});

describe('calculateLineTotal', () => {
  it('multiplies (unit + adjustment) by quantity', () => {
    const mods = [{ group_name: 'M', option_label: 'O', price_adjustment: 5000 }];
    expect(calculateLineTotal(35000, mods, 2)).toBe(80000);
  });

  it('returns unit_price * qty when no modifiers', () => {
    expect(calculateLineTotal(35000, [], 3)).toBe(105000);
  });
});

describe('calculatePriceAdjustment — defensive', () => {
  it('treats nullish price_adjustment as 0 (runtime guard)', () => {
    const mods = [
      { group_name: 'G', option_label: 'O', price_adjustment: null as unknown as number },
    ];
    expect(calculatePriceAdjustment(mods)).toBe(0);
  });
});
