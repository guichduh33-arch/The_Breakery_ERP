import { REDEMPTION_RATE } from './constants.js';

export function pointsToValue(points: number): number {
  return points * REDEMPTION_RATE;
}
