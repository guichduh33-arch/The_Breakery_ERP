import { describe, it, expect } from 'vitest';
import { splitEqualAmounts, validateCustomSplit } from '../splitModes';

describe('splitEqualAmounts', () => {
  it('splits evenly when divisible', () => {
    expect(splitEqualAmounts(90_000, 3)).toEqual([30_000, 30_000, 30_000]);
  });
  it('last payer absorbs the rounding remainder, sum is exact', () => {
    const parts = splitEqualAmounts(100_000, 3);
    expect(parts).toEqual([33_333, 33_333, 33_334]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100_000);
  });
  it('every part stays positive', () => {
    expect(splitEqualAmounts(5, 5)).toEqual([1, 1, 1, 1, 1]);
  });
  it('throws on count out of 2..5', () => {
    expect(() => splitEqualAmounts(100, 1)).toThrow();
    expect(() => splitEqualAmounts(100, 6)).toThrow();
  });
  it('throws on non-positive total', () => {
    expect(() => splitEqualAmounts(0, 2)).toThrow();
  });
});

describe('validateCustomSplit', () => {
  it('accepts exact sum', () => {
    expect(validateCustomSplit(100_000, [60_000, 40_000])).toEqual({ ok: true });
  });
  it('rejects sum mismatch with delta', () => {
    expect(validateCustomSplit(100_000, [60_000, 30_000])).toEqual({ ok: false, reason: 'sum_mismatch', delta: 10_000 });
  });
  it('rejects bad count', () => {
    expect(validateCustomSplit(100, [100])).toEqual({ ok: false, reason: 'bad_count' });
  });
  it('rejects non-positive amounts', () => {
    expect(validateCustomSplit(100, [110, -10])).toEqual({ ok: false, reason: 'nonpositive_amount' });
  });
});
