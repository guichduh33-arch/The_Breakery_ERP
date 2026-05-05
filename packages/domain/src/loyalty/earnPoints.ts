import { POINTS_PER_AMOUNT } from './constants.js';
import { TIERS, tierFromLifetime } from './tiers.js';

/**
 * Compute points earned for a transaction amount.
 * multiplier defaults to 1.0 (backwards-compatible).
 */
export function earnPointsFor(amount: number, multiplier = 1.0): number {
  if (!Number.isFinite(amount) || amount < 0) return 0;
  if (!Number.isFinite(multiplier) || multiplier <= 0) return 0;
  return Math.floor((amount * multiplier) / POINTS_PER_AMOUNT);
}

/**
 * Convenience helper for callers that hold customer state but not the multiplier.
 * Resolves the tier from lifetime_points, reads its points_multiplier,
 * then delegates to earnPointsFor.
 */
export function earnPointsForCustomer(amount: number, lifetime_points: number): number {
  const tier = tierFromLifetime(lifetime_points);
  const tierData = TIERS.find((t) => t.tier === tier)!;
  return earnPointsFor(amount, tierData.points_multiplier);
}
