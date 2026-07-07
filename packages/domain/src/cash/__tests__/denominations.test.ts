import { describe, expect, it } from 'vitest';
import { IDR_DENOMINATIONS, isValidDenominationGrid, sumDenominations } from '../denominations';

describe('IDR_DENOMINATIONS', () => {
  it('is the canonical descending list (mirror of close_shift_v5)', () => {
    expect([...IDR_DENOMINATIONS]).toEqual([
      100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100,
    ]);
  });
});

describe('sumDenominations', () => {
  it('sums face value × quantity', () => {
    expect(sumDenominations({ '100000': 3, '50000': 1, '500': 4 })).toBe(352_000);
  });
  it('returns 0 for an empty grid', () => {
    expect(sumDenominations({})).toBe(0);
  });
  it('ignores zero quantities', () => {
    expect(sumDenominations({ '100000': 0, '2000': 2 })).toBe(4_000);
  });
});

describe('isValidDenominationGrid', () => {
  it('accepts known keys with non-negative integer quantities', () => {
    expect(isValidDenominationGrid({ '100000': 2, '100': 0 })).toBe(true);
  });
  it('rejects unknown denominations', () => {
    expect(isValidDenominationGrid({ '75000': 1 })).toBe(false);
  });
  it('rejects negative or fractional quantities', () => {
    expect(isValidDenominationGrid({ '1000': -1 })).toBe(false);
    expect(isValidDenominationGrid({ '1000': 1.5 })).toBe(false);
  });
});
