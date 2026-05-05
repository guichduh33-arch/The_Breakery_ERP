import { describe, it, expect } from 'vitest';
import { validateRedeem } from '../validateRedeem';

describe('validateRedeem', () => {
  it('returns empty array when points is 0 (no redemption)', () => {
    expect(validateRedeem(0, 1000, 50000, false)).toEqual([]);
    expect(validateRedeem(0, 0, 0, false)).toEqual([]);
  });

  it('returns empty array for valid redemption', () => {
    expect(validateRedeem(100, 500, 10000, true)).toEqual([]);
    expect(validateRedeem(500, 2500, 35000, true)).toEqual([]);
  });

  it('requires customer_attached when points > 0', () => {
    const errors = validateRedeem(100, 500, 10000, false);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('customer_required');
  });

  it('stops checking after customer_required error', () => {
    // 50 pts: below min AND not multiple of 100, but customer not attached comes first
    const errors = validateRedeem(50, 500, 10000, false);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('customer_required');
  });

  it('returns below_minimum when points < 100', () => {
    const errors = validateRedeem(50, 500, 10000, true);
    expect(errors.some((e) => e.code === 'below_minimum')).toBe(true);
  });

  it('returns not_multiple_of_100 when points not divisible by 100', () => {
    const errors = validateRedeem(150, 500, 10000, true);
    expect(errors.some((e) => e.code === 'not_multiple_of_100')).toBe(true);
  });

  it('returns not_multiple_of_100 for 101 points', () => {
    const errors = validateRedeem(101, 500, 10000, true);
    expect(errors.some((e) => e.code === 'not_multiple_of_100')).toBe(true);
  });

  it('returns insufficient_balance when points > balance', () => {
    const errors = validateRedeem(600, 500, 10000, true);
    expect(errors.some((e) => e.code === 'insufficient_balance')).toBe(true);
  });

  it('returns exceeds_order_total when redemption value exceeds items_total', () => {
    // 500 pts * 10 = 5000 IDR > 3000 IDR
    const errors = validateRedeem(500, 1000, 3000, true);
    expect(errors.some((e) => e.code === 'exceeds_order_total')).toBe(true);
  });

  it('allows redemption equal to items_total', () => {
    // 300 pts * 10 = 3000 IDR = 3000 IDR total
    const errors = validateRedeem(300, 1000, 3000, true);
    expect(errors).toEqual([]);
  });

  it('accumulates multiple errors', () => {
    // 50 pts: below_minimum + not_multiple_of_100 + insufficient (balance=20)
    const errors = validateRedeem(50, 20, 10000, true);
    const codes = errors.map((e) => e.code);
    expect(codes).toContain('below_minimum');
    expect(codes).toContain('not_multiple_of_100');
    expect(codes).toContain('insufficient_balance');
  });

  it('all errors include message string', () => {
    const errors = validateRedeem(50, 10, 100, true);
    for (const err of errors) {
      expect(typeof err.message).toBe('string');
      expect(err.message.length).toBeGreaterThan(0);
    }
  });

  it('exactly 100 points with sufficient balance passes', () => {
    expect(validateRedeem(100, 100, 1000, true)).toEqual([]);
  });
});
