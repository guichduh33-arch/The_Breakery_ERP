import type { LoyaltyTier } from './types.js';

export const TIERS = [
  { tier: 'bronze',   min: 0,    label: 'Bronze',   points_multiplier: 1.0  },
  { tier: 'silver',   min: 500,  label: 'Silver',   points_multiplier: 1.05 },
  { tier: 'gold',     min: 2000, label: 'Gold',     points_multiplier: 1.1  },
  { tier: 'platinum', min: 5000, label: 'Platinum', points_multiplier: 1.2  },
] as const;

export function tierFromLifetime(points: number): LoyaltyTier {
  if (points >= 5000) return 'platinum';
  if (points >= 2000) return 'gold';
  if (points >= 500)  return 'silver';
  return 'bronze';
}
