import { describe, it, expect } from 'vitest';
import { validateDiscount } from '../validateDiscount';
import type { Discount } from '../types';

const validPercentage: Discount = {
  type: 'percentage',
  value: 10,
  amount: 3500,
  reason: 'Staff promo',
};

const validFixed: Discount = {
  type: 'fixed_amount',
  value: 5000,
  amount: 5000,
  reason: 'Manager approved',
};

describe('validateDiscount — reason', () => {
  it('returns no error for valid reason >= 5 chars', () => {
    const errs = validateDiscount(validPercentage, 35000);
    expect(errs.map((e) => e.code)).not.toContain('reason_too_short');
  });

  it('flags reason shorter than 5 chars', () => {
    const errs = validateDiscount({ ...validPercentage, reason: 'OK' }, 35000);
    expect(errs.some((e) => e.code === 'reason_too_short')).toBe(true);
  });

  it('flags empty reason', () => {
    const errs = validateDiscount({ ...validPercentage, reason: '' }, 35000);
    expect(errs.some((e) => e.code === 'reason_too_short')).toBe(true);
  });

  it('flags whitespace-only reason', () => {
    const errs = validateDiscount({ ...validPercentage, reason: '     ' }, 35000);
    expect(errs.some((e) => e.code === 'reason_too_short')).toBe(true);
  });

  it('accepts exactly 5 non-space chars', () => {
    const errs = validateDiscount({ ...validPercentage, reason: 'abcde' }, 35000);
    expect(errs.map((e) => e.code)).not.toContain('reason_too_short');
  });
});

describe('validateDiscount — percentage range', () => {
  it('returns no error for value=10 percentage', () => {
    expect(validateDiscount(validPercentage, 35000)).toEqual([]);
  });

  it('returns no error for value=100 percentage', () => {
    const d: Discount = { type: 'percentage', value: 100, amount: 35000, reason: 'Full wipe' };
    expect(validateDiscount(d, 35000)).toEqual([]);
  });

  it('flags percentage value=0', () => {
    const d: Discount = { type: 'percentage', value: 0, amount: 0, reason: 'abcde' };
    const errs = validateDiscount(d, 35000);
    expect(errs.some((e) => e.code === 'value_invalid')).toBe(true);
  });

  it('flags percentage value > 100', () => {
    const d: Discount = { type: 'percentage', value: 101, amount: 35000, reason: 'abcde' };
    const errs = validateDiscount(d, 35000);
    expect(errs.some((e) => e.code === 'value_invalid')).toBe(true);
  });
});

describe('validateDiscount — fixed_amount range', () => {
  it('returns no error for valid fixed discount', () => {
    expect(validateDiscount(validFixed, 35000)).toEqual([]);
  });

  it('flags fixed value=0', () => {
    const d: Discount = { type: 'fixed_amount', value: 0, amount: 0, reason: 'abcde' };
    const errs = validateDiscount(d, 35000);
    expect(errs.some((e) => e.code === 'value_invalid')).toBe(true);
  });

  it('flags negative fixed value', () => {
    const d: Discount = { type: 'fixed_amount', value: -1000, amount: 0, reason: 'abcde' };
    const errs = validateDiscount(d, 35000);
    expect(errs.some((e) => e.code === 'value_invalid')).toBe(true);
  });
});

describe('validateDiscount — amount checks', () => {
  it('flags amount=0 even if value is non-zero', () => {
    const d: Discount = { type: 'fixed_amount', value: 5000, amount: 0, reason: 'Staff promo' };
    const errs = validateDiscount(d, 35000);
    expect(errs.some((e) => e.code === 'value_invalid')).toBe(true);
  });

  it('flags amount exceeding base', () => {
    const d: Discount = { type: 'fixed_amount', value: 40000, amount: 40000, reason: 'Staff promo' };
    const errs = validateDiscount(d, 35000);
    expect(errs.some((e) => e.code === 'exceeds_base')).toBe(true);
  });

  it('returns no error when amount equals base exactly', () => {
    const d: Discount = { type: 'fixed_amount', value: 35000, amount: 35000, reason: 'Staff promo' };
    expect(validateDiscount(d, 35000)).toEqual([]);
  });
});
