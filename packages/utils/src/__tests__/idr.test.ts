// packages/utils/src/__tests__/idr.test.ts
import { describe, it, expect } from 'vitest';
import { roundIdr, formatIdr } from '../idr';

describe('roundIdr', () => {
  it('rounds to nearest 100', () => {
    expect(roundIdr(123)).toBe(100);
    expect(roundIdr(150)).toBe(200);
    expect(roundIdr(149)).toBe(100);
    expect(roundIdr(7273.5)).toBe(7300);
    expect(roundIdr(0)).toBe(0);
  });
  it('handles negatives (refund)', () => {
    expect(roundIdr(-150)).toBe(-200);
    expect(roundIdr(-149)).toBe(-100);
  });
});

describe('formatIdr', () => {
  it('formats with Rp prefix and thousands separator', () => {
    expect(formatIdr(35000)).toBe('Rp 35,000');
    expect(formatIdr(7273)).toBe('Rp 7,273');
    expect(formatIdr(0)).toBe('Rp 0');
    expect(formatIdr(1234567)).toBe('Rp 1,234,567');
  });
  it('handles negatives', () => {
    expect(formatIdr(-35000)).toBe('-Rp 35,000');
  });
});
