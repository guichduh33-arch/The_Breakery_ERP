import { describe, it, expect } from 'vitest';
import { pointsToValue } from '../redeemValue';

describe('pointsToValue', () => {
  it('returns 0 for 0 points', () => {
    expect(pointsToValue(0)).toBe(0);
  });

  it('converts 100 points to 1000 IDR', () => {
    expect(pointsToValue(100)).toBe(1000);
  });

  it('converts 500 points to 5000 IDR', () => {
    expect(pointsToValue(500)).toBe(5000);
  });

  it('multiplies by 10 (each point = 10 IDR)', () => {
    expect(pointsToValue(1)).toBe(10);
    expect(pointsToValue(2500)).toBe(25000);
    expect(pointsToValue(10000)).toBe(100000);
  });
});
