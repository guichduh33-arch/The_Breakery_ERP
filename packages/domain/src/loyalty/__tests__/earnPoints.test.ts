import { describe, it, expect } from 'vitest';
import { earnPointsFor } from '../earnPoints';

describe('earnPointsFor', () => {
  it('returns 0 for amount below 1000', () => {
    expect(earnPointsFor(999)).toBe(0);
    expect(earnPointsFor(0)).toBe(0);
    expect(earnPointsFor(1)).toBe(0);
  });

  it('returns 1 for exactly 1000 IDR', () => {
    expect(earnPointsFor(1000)).toBe(1);
  });

  it('floors fractional results', () => {
    expect(earnPointsFor(1999)).toBe(1);
    expect(earnPointsFor(1500)).toBe(1);
  });

  it('returns 35 for 35000 IDR', () => {
    expect(earnPointsFor(35000)).toBe(35);
  });

  it('handles large amounts', () => {
    expect(earnPointsFor(1_000_000)).toBe(1000);
    expect(earnPointsFor(9_999_999)).toBe(9999);
  });

  it('returns 0 for negative input', () => {
    expect(earnPointsFor(-1000)).toBe(0);
    expect(earnPointsFor(-1)).toBe(0);
  });

  it('returns 0 for non-finite input', () => {
    expect(earnPointsFor(Infinity)).toBe(0);
    expect(earnPointsFor(-Infinity)).toBe(0);
    expect(earnPointsFor(NaN)).toBe(0);
  });
});
