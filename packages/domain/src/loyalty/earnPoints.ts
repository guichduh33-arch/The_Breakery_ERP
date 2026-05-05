import { POINTS_PER_AMOUNT } from './constants.js';

export function earnPointsFor(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.floor(amount / POINTS_PER_AMOUNT);
}
