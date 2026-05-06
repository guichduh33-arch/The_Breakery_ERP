import { describe, it, expect } from 'vitest';
import { tierFromLifetime, TIERS } from '../tiers';

describe('tierFromLifetime', () => {
  it('returns bronze at 0 points', () => {
    expect(tierFromLifetime(0)).toBe('bronze');
  });

  it('returns bronze below silver threshold (499)', () => {
    expect(tierFromLifetime(499)).toBe('bronze');
    expect(tierFromLifetime(1)).toBe('bronze');
  });

  it('returns silver at 500', () => {
    expect(tierFromLifetime(500)).toBe('silver');
  });

  it('returns silver below gold threshold (1999)', () => {
    expect(tierFromLifetime(1999)).toBe('silver');
    expect(tierFromLifetime(501)).toBe('silver');
  });

  it('returns gold at 2000', () => {
    expect(tierFromLifetime(2000)).toBe('gold');
  });

  it('returns gold below platinum threshold (4999)', () => {
    expect(tierFromLifetime(4999)).toBe('gold');
    expect(tierFromLifetime(2001)).toBe('gold');
  });

  it('returns platinum at 5000', () => {
    expect(tierFromLifetime(5000)).toBe('platinum');
  });

  it('returns platinum above 5000', () => {
    expect(tierFromLifetime(10000)).toBe('platinum');
    expect(tierFromLifetime(5001)).toBe('platinum');
  });
});

describe('TIERS constant', () => {
  it('has four tiers in ascending min order', () => {
    expect(TIERS).toHaveLength(4);
    expect(TIERS[0].tier).toBe('bronze');
    expect(TIERS[1].tier).toBe('silver');
    expect(TIERS[2].tier).toBe('gold');
    expect(TIERS[3].tier).toBe('platinum');
  });

  it('has correct min thresholds', () => {
    expect(TIERS[0].min).toBe(0);
    expect(TIERS[1].min).toBe(500);
    expect(TIERS[2].min).toBe(2000);
    expect(TIERS[3].min).toBe(5000);
  });

  it('has correct labels', () => {
    expect(TIERS[0].label).toBe('Bronze');
    expect(TIERS[3].label).toBe('Platinum');
  });

  it('exposes discount field for each tier', () => {
    expect(TIERS[0].discount).toBe(0);
    expect(TIERS[1].discount).toBe(5);
    expect(TIERS[2].discount).toBe(8);
    expect(TIERS[3].discount).toBe(10);
  });

  it('has correct points_multiplier for Bronze (1.0)', () => {
    expect(TIERS[0].points_multiplier).toBe(1.0);
  });

  it('has correct points_multiplier for Silver (1.05)', () => {
    expect(TIERS[1].points_multiplier).toBe(1.05);
  });

  it('has correct points_multiplier for Gold (1.1)', () => {
    expect(TIERS[2].points_multiplier).toBe(1.1);
  });

  it('has correct points_multiplier for Platinum (1.2)', () => {
    expect(TIERS[3].points_multiplier).toBe(1.2);
  });
});
