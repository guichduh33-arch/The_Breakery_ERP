import type { LoyaltyTier } from './types.js';

export const TIERS = [
  { tier: 'bronze',   min: 0,    discount: 0,  label: 'Bronze'   },
  { tier: 'silver',   min: 500,  discount: 5,  label: 'Silver'   },
  { tier: 'gold',     min: 2000, discount: 8,  label: 'Gold'     },
  { tier: 'platinum', min: 5000, discount: 10, label: 'Platinum' },
] as const;

export function tierFromLifetime(points: number): LoyaltyTier {
  if (points >= 5000) return 'platinum';
  if (points >= 2000) return 'gold';
  if (points >= 500)  return 'silver';
  return 'bronze';
}
