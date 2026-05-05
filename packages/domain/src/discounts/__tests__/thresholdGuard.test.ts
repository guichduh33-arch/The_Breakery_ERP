import { describe, it, expect } from 'vitest';
import { isAboveThreshold } from '../thresholdGuard';

describe('isAboveThreshold', () => {
  it('returns false for 0 base', () => {
    expect(isAboveThreshold(1000, 0)).toBe(false);
  });

  it('returns false for 0 amount', () => {
    expect(isAboveThreshold(0, 35000)).toBe(false);
  });

  it('returns false at exactly 10% (boundary exclusive)', () => {
    // 3500 / 35000 = 0.10 exactly
    expect(isAboveThreshold(3500, 35000)).toBe(false);
  });

  it('returns true at 11%', () => {
    // 3850 / 35000 ≈ 0.11
    expect(isAboveThreshold(3850, 35000)).toBe(true);
  });

  it('returns true at 10.01%', () => {
    expect(isAboveThreshold(3501, 35000)).toBe(true);
  });

  it('returns false for 9%', () => {
    // 3150 / 35000 = 0.09
    expect(isAboveThreshold(3150, 35000)).toBe(false);
  });

  it('returns true when amount equals base (100%)', () => {
    expect(isAboveThreshold(35000, 35000)).toBe(true);
  });

  it('supports a custom threshold', () => {
    // threshold = 0.20 → 20%
    expect(isAboveThreshold(7000, 35000, 0.20)).toBe(false);  // exactly 20%, boundary
    expect(isAboveThreshold(7001, 35000, 0.20)).toBe(true);
    expect(isAboveThreshold(6999, 35000, 0.20)).toBe(false);
  });
});
