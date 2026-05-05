import { describe, it, expect } from 'vitest';
import { calculateDiscountAmount } from '../calculateDiscountAmount';

describe('calculateDiscountAmount — percentage', () => {
  it('calculates 10% of 35000 as 3500', () => {
    expect(calculateDiscountAmount({ type: 'percentage', value: 10 }, 35000)).toBe(3500);
  });

  it('calculates 100% of base as base', () => {
    expect(calculateDiscountAmount({ type: 'percentage', value: 100 }, 20000)).toBe(20000);
  });

  it('rounds to nearest integer IDR', () => {
    // 15% of 33333 = 4999.95 → rounded to 5000
    expect(calculateDiscountAmount({ type: 'percentage', value: 15 }, 33333)).toBe(5000);
  });

  it('returns 0 for 0 base', () => {
    expect(calculateDiscountAmount({ type: 'percentage', value: 10 }, 0)).toBe(0);
  });

  it('returns 0 for negative base', () => {
    expect(calculateDiscountAmount({ type: 'percentage', value: 10 }, -1)).toBe(0);
  });

  it('returns 0 for 0 value', () => {
    expect(calculateDiscountAmount({ type: 'percentage', value: 0 }, 35000)).toBe(0);
  });

  it('returns 0 for negative value', () => {
    expect(calculateDiscountAmount({ type: 'percentage', value: -5 }, 35000)).toBe(0);
  });

  it('returns 0 for NaN value', () => {
    expect(calculateDiscountAmount({ type: 'percentage', value: NaN }, 35000)).toBe(0);
  });

  it('caps at base even if value overshoots', () => {
    // Defensive: 200% would exceed base
    expect(calculateDiscountAmount({ type: 'percentage', value: 200 }, 10000)).toBe(10000);
  });
});

describe('calculateDiscountAmount — fixed_amount', () => {
  it('returns the fixed value when less than base', () => {
    expect(calculateDiscountAmount({ type: 'fixed_amount', value: 5000 }, 35000)).toBe(5000);
  });

  it('caps at base when value exceeds base', () => {
    expect(calculateDiscountAmount({ type: 'fixed_amount', value: 50000 }, 35000)).toBe(35000);
  });

  it('returns base when value equals base exactly', () => {
    expect(calculateDiscountAmount({ type: 'fixed_amount', value: 35000 }, 35000)).toBe(35000);
  });

  it('returns 0 for 0 base', () => {
    expect(calculateDiscountAmount({ type: 'fixed_amount', value: 5000 }, 0)).toBe(0);
  });

  it('returns 0 for 0 value', () => {
    expect(calculateDiscountAmount({ type: 'fixed_amount', value: 0 }, 35000)).toBe(0);
  });

  it('returns 0 for negative value', () => {
    expect(calculateDiscountAmount({ type: 'fixed_amount', value: -1000 }, 35000)).toBe(0);
  });
});
