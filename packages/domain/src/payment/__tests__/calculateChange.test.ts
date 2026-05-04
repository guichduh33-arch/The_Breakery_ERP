// packages/domain/src/payment/__tests__/calculateChange.test.ts
import { describe, it, expect } from 'vitest';
import { calculateChange } from '../calculateChange';

describe('calculateChange', () => {
  it('returns positive change', () => {
    expect(calculateChange(80000, 100000)).toBe(20000);
  });
  it('returns 0 for exact', () => {
    expect(calculateChange(80000, 80000)).toBe(0);
  });
  it('returns 0 if received less than total (clamped, with warning behavior)', () => {
    expect(calculateChange(80000, 50000)).toBe(0);
  });
});
