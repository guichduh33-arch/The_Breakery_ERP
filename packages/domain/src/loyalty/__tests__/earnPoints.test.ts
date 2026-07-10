import { describe, it, expect } from 'vitest';
import { earnPointsFor, earnPointsForCustomer, resolveLoyaltyMultiplier } from '../earnPoints';

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

  it('returns 35 for 35000 IDR (Bronze multiplier 1.0)', () => {
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

  it('applies Silver multiplier 1.05 — 35000 → 36 (floor)', () => {
    // floor(35000 * 1.05 / 1000) = floor(36.75) = 36
    expect(earnPointsFor(35000, 1.05)).toBe(36);
  });

  it('applies Gold multiplier 1.1 — 35000 → 38 (floor)', () => {
    // floor(35000 * 1.1 / 1000) = floor(38.5) = 38
    expect(earnPointsFor(35000, 1.1)).toBe(38);
  });

  it('applies Platinum multiplier 1.2 — 35000 → 42 (floor)', () => {
    // floor(35000 * 1.2 / 1000) = floor(42.0) = 42
    expect(earnPointsFor(35000, 1.2)).toBe(42);
  });

  it('returns 0 for 0 amount with multiplier', () => {
    expect(earnPointsFor(0, 1.2)).toBe(0);
  });

  it('returns 0 for invalid multiplier', () => {
    expect(earnPointsFor(35000, 0)).toBe(0);
    expect(earnPointsFor(35000, -1)).toBe(0);
    expect(earnPointsFor(35000, NaN)).toBe(0);
  });
});

describe('earnPointsForCustomer', () => {
  it('uses Bronze multiplier (1.0) for 0 lifetime points', () => {
    // floor(35000 * 1.0 / 1000) = 35
    expect(earnPointsForCustomer(35000, 0)).toBe(35);
  });

  it('uses Bronze multiplier (1.0) for 499 lifetime points', () => {
    expect(earnPointsForCustomer(35000, 499)).toBe(35);
  });

  it('uses Silver multiplier (1.05) for 500 lifetime points', () => {
    expect(earnPointsForCustomer(35000, 500)).toBe(36);
  });

  it('uses Gold multiplier (1.1) for 2000 lifetime points', () => {
    expect(earnPointsForCustomer(35000, 2000)).toBe(38);
  });

  it('uses Gold multiplier (1.1) for 2500 lifetime points', () => {
    expect(earnPointsForCustomer(35000, 2500)).toBe(38);
  });

  it('uses Platinum multiplier (1.2) for 5000 lifetime points', () => {
    expect(earnPointsForCustomer(35000, 5000)).toBe(42);
  });
});

describe('resolveLoyaltyMultiplier (S72 — tier × category)', () => {
  it('tier only when no category multiplier given', () => {
    expect(resolveLoyaltyMultiplier(0)).toBe(1.0);       // bronze
    expect(resolveLoyaltyMultiplier(500)).toBeCloseTo(1.05); // silver
    expect(resolveLoyaltyMultiplier(5000)).toBeCloseTo(1.2); // platinum
  });

  it('multiplies tier by category', () => {
    // gold 1.1 × category 2.0 = 2.2
    expect(resolveLoyaltyMultiplier(2000, 2.0)).toBeCloseTo(2.2);
    // silver 1.05 × category 1.5 = 1.575
    expect(resolveLoyaltyMultiplier(500, 1.5)).toBeCloseTo(1.575);
  });

  it('falls back to tier-only for an invalid category multiplier', () => {
    expect(resolveLoyaltyMultiplier(2000, 0)).toBeCloseTo(1.1);
    expect(resolveLoyaltyMultiplier(2000, -1)).toBeCloseTo(1.1);
    expect(resolveLoyaltyMultiplier(2000, NaN)).toBeCloseTo(1.1);
  });

  it('feeds earnPointsFor identically to the cart line and payment summary', () => {
    // gold 1.1 × category 2.0, 35000 IDR -> floor(35000 * 2.2 / 1000) = 77
    const mult = resolveLoyaltyMultiplier(2000, 2.0);
    expect(earnPointsFor(35000, mult)).toBe(77);
  });
});
