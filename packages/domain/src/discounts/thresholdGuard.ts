// packages/domain/src/discounts/thresholdGuard.ts
// Spec §4.1 (critical note 4): manager-PIN gating for discounts > 10% of base.

/**
 * Returns true only when amount / base is STRICTLY greater than the threshold.
 * - base === 0 → false (no order yet)
 * - amount === 0 → false
 * - amount === base * threshold exactly → false (boundary is exclusive)
 * @param threshold defaults to 0.10 (10%)
 */
export function isAboveThreshold(
  amount: number,
  base: number,
  threshold = 0.10,
): boolean {
  if (base === 0 || amount === 0) return false;
  return amount / base > threshold;
}
